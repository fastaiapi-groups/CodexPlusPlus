//! 系统凭据库：安装包与状态目录中均不写入明文会话/密码。
pub(crate) fn account() -> String {
    std::env::var("CODEX_PLUS_STATE_DIR").ok().filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "default".into())
}

pub(crate) fn load(service: &str) -> Option<Vec<u8>> {
    #[cfg(target_os = "macos")]
    { security_framework::passwords::get_generic_password(service, &account()).ok() }
    #[cfg(windows)]
    { windows_store::load(service, &account()) }
    #[cfg(not(any(target_os = "macos", windows)))]
    { let _ = service; None }
}

pub(crate) fn save(service: &str, bytes: &[u8]) -> bool {
    #[cfg(target_os = "macos")]
    { security_framework::passwords::set_generic_password(service, &account(), bytes).is_ok() }
    #[cfg(windows)]
    { windows_store::save(service, &account(), bytes) }
    #[cfg(not(any(target_os = "macos", windows)))]
    { let _ = (service, bytes); false }
}

pub(crate) fn clear(service: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if let Err(error) = security_framework::passwords::delete_generic_password(service, &account()) {
        if error.code() != -25300 { return Err("无法清除系统凭据，请允许访问系统凭据库后重试".into()); }
    }
    #[cfg(windows)]
    windows_store::clear(service, &account())?;
    let _ = service;
    Ok(())
}

#[cfg(windows)]
mod windows_store {
    use sha2::{Digest, Sha256};
    use windows::core::{PCWSTR, PWSTR, HRESULT};
    use windows::Win32::Foundation::ERROR_NOT_FOUND;
    use windows::Win32::Security::Credentials::*;

    fn target(service: &str, account: &str) -> Vec<u16> {
        // 目录只参与稳定命名空间计算，不暴露用户路径，更新/换安装目录不改变默认身份。
        format!("{service}:{:x}", Sha256::digest(account.as_bytes())).encode_utf16().chain(Some(0)).collect()
    }

    pub(super) fn load(service: &str, account: &str) -> Option<Vec<u8>> {
        let name = target(service, account);
        let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
        // SAFETY: 名称以 NUL 结尾；成功分配的凭据由 CredFree 释放。
        unsafe {
            CredReadW(PCWSTR(name.as_ptr()), CRED_TYPE_GENERIC, 0, &mut credential).ok()?;
            if credential.is_null() { return None; }
            let value = &*credential;
            let bytes = if value.CredentialBlobSize == 0 { Some(Vec::new()) }
                else if value.CredentialBlob.is_null() || value.CredentialBlobSize > CRED_MAX_CREDENTIAL_BLOB_SIZE { None }
                else { Some(std::slice::from_raw_parts(value.CredentialBlob, value.CredentialBlobSize as usize).to_vec()) };
            CredFree(credential.cast());
            bytes
        }
    }

    pub(super) fn save(service: &str, account: &str, bytes: &[u8]) -> bool {
        if bytes.len() > CRED_MAX_CREDENTIAL_BLOB_SIZE as usize { return false; }
        let mut name = target(service, account);
        let mut user: Vec<u16> = "FastAiApi".encode_utf16().chain(Some(0)).collect();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC, TargetName: PWSTR(name.as_mut_ptr()),
            CredentialBlobSize: bytes.len() as u32, CredentialBlob: bytes.as_ptr().cast_mut(),
            Persist: CRED_PERSIST_LOCAL_MACHINE, UserName: PWSTR(user.as_mut_ptr()),
            ..Default::default()
        };
        // SAFETY: 所有缓冲区在同步 API 返回前有效；该 API 不修改输入 blob。
        unsafe { CredWriteW(&credential, 0).is_ok() }
    }

    pub(super) fn clear(service: &str, account: &str) -> Result<(), String> {
        let name = target(service, account);
        // SAFETY: 名称有效且以 NUL 结尾，删除只针对本站当前命名空间。
        match unsafe { CredDeleteW(PCWSTR(name.as_ptr()), CRED_TYPE_GENERIC, 0) } {
            Ok(()) => Ok(()),
            Err(error) if error.code() == HRESULT::from_win32(ERROR_NOT_FOUND.0) => Ok(()),
            Err(_) => Err("无法清除 Windows 系统凭据，请重试".into()),
        }
    }
}
