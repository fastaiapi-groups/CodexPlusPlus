//! New API 公开 token 阶梯表达式的只读展示适配，不执行平台代码。
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub(crate) fn expression_tiers(expression: &str, factor: f64) -> Option<Vec<Value>> {
    if expression.len() > 16_384 || !factor.is_finite() || factor < 0.0 {
        return None;
    }
    let mut parser = Parser {
        rest: expression.strip_prefix("v1:").unwrap_or(expression),
        factor,
        rows: vec![],
    };
    parser.branch(vec![], 0)?;
    (parser.rest.trim().is_empty() && !parser.rows.is_empty()).then_some(parser.rows)
}

struct Parser<'a> {
    rest: &'a str,
    factor: f64,
    rows: Vec<Value>,
}

impl<'a> Parser<'a> {
    fn take(&mut self, token: &str) -> bool {
        self.rest = self.rest.trim_start();
        if let Some(rest) = self.rest.strip_prefix(token) {
            self.rest = rest;
            true
        } else {
            false
        }
    }

    fn word(&mut self) -> Option<&'a str> {
        self.rest = self.rest.trim_start();
        let end = self
            .rest
            .bytes()
            .take_while(|b| b.is_ascii_alphanumeric() || *b == b'_')
            .count();
        if end == 0 || end > 64 {
            return None;
        }
        let result = &self.rest[..end];
        self.rest = &self.rest[end..];
        Some(result)
    }

    fn number(&mut self) -> Option<f64> {
        self.rest = self.rest.trim_start();
        let bytes = self.rest.as_bytes();
        let mut end = 0;
        while bytes
            .get(end)
            .is_some_and(|b| b.is_ascii_digit() || *b == b'.')
        {
            end += 1;
        }
        if end == 0 {
            return None;
        }
        if bytes.get(end).is_some_and(|b| matches!(b, b'e' | b'E')) {
            end += 1;
            if bytes.get(end).is_some_and(|b| matches!(b, b'+' | b'-')) {
                end += 1;
            }
            while bytes.get(end).is_some_and(u8::is_ascii_digit) {
                end += 1;
            }
        }
        let number: f64 = self.rest[..end].parse().ok()?;
        if !number.is_finite() || number < 0.0 {
            return None;
        }
        self.rest = &self.rest[end..];
        Some(number)
    }

    fn label(&mut self) -> Option<String> {
        self.rest = self.rest.trim_start();
        if !self.rest.starts_with('"') {
            return None;
        }
        let mut escaped = false;
        for (index, byte) in self.rest.bytes().enumerate().skip(1) {
            if escaped {
                escaped = false;
                continue;
            }
            if byte == b'\\' {
                escaped = true;
                continue;
            }
            if byte == b'"' {
                let label: String = serde_json::from_str(&self.rest[..=index]).ok()?;
                if label.len() > 256 {
                    return None;
                }
                self.rest = &self.rest[index + 1..];
                return Some(label);
            }
        }
        None
    }

    fn branch(&mut self, path: Vec<String>, depth: u8) -> Option<()> {
        if depth > 16 || self.rows.len() >= 32 {
            return None;
        }
        let name = self.word()?;
        if name == "tier" {
            if !self.take("(") {
                return None;
            }
            let label = self.label()?;
            if !self.take(",") {
                return None;
            }
            let mut prices = BTreeMap::<&str, f64>::new();
            loop {
                let variable = self.word()?;
                if !["p", "c", "cr", "cc", "cc1h", "cc12h"].contains(&variable) || !self.take("*") {
                    return None;
                }
                *prices.entry(variable).or_default() += self.number()?;
                if !self.take("+") {
                    break;
                }
            }
            if !self.take(")") {
                return None;
            }
            let input = prices.get("p")? * self.factor;
            let output = prices.get("c")? * self.factor;
            let cache = prices.get("cr").unwrap_or(prices.get("p")?) * self.factor;
            if ![input, output, cache].iter().all(|v| v.is_finite()) {
                return None;
            }
            self.rows.push(json!({"label":if path.is_empty() {label} else {path.join(" · ")}, "input":input,"output":output,"cache":cache}));
            return Some(());
        }
        let metric = match name {
            "len" => "",
            "p" => "输入",
            "c" => "输出",
            _ => return None,
        };
        let operator = ["<=", ">=", "<", ">"]
            .into_iter()
            .find(|op| self.take(op))?;
        let threshold = self.number()?;
        if !self.take("?") {
            return None;
        }
        let size = if threshold >= 1000.0 && threshold % 1000.0 == 0.0 {
            format!("{}K", threshold / 1000.0)
        } else {
            threshold.to_string()
        };
        let display = match operator {
            "<=" => "≤",
            ">=" => "≥",
            other => other,
        };
        let inverse = match operator {
            "<=" => ">",
            ">=" => "<",
            "<" => "≥",
            _ => "≤",
        };
        let mut yes = path.clone();
        yes.push(format!("{metric}{display}{size}"));
        self.branch(yes, depth + 1)?;
        if !self.take(":") {
            return None;
        }
        let mut no = path;
        no.push(format!("{metric}{inverse}{size}"));
        self.branch(no, depth + 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tier_coefficients_are_prices_and_only_apply_group_and_currency_factor() {
        let tiers = expression_tiers(r#"len <= 272000 ? tier("0_272k", p * 2.4 + cr * 0.12 + cc * 3 + c * 12) : tier("272k_plus", p * 4.8 + cr * 0.24 + cc * 6 + c * 18)"#, 2.0).unwrap();
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0]["label"], "≤272K");
        assert_eq!(tiers[0]["input"], 4.8);
        assert_eq!(tiers[0]["output"], 24.0);
        assert_eq!(tiers[0]["cache"], 0.24);
        assert_eq!(tiers[1]["label"], ">272K");
        assert_eq!(tiers[1]["input"], 9.6);
    }

    #[test]
    fn nested_tiers_keep_both_bounds_and_missing_cache_uses_input_rate() {
        let tiers = expression_tiers(r#"v1:len <= 128000 ? tier("small", p * 1 + c * 2) : len <= 272000 ? tier("medium", p * 2 + c * 4) : tier("large", p * 3 + c * 6)"#, 1.0).unwrap();
        assert_eq!(tiers[1]["label"], ">128K · ≤272K");
        assert_eq!(tiers[2]["cache"], 3.0);
    }

    #[test]
    fn unsupported_dynamic_and_malformed_expressions_never_fabricate_prices() {
        for expression in [
            r#"tier("base", p * 2 + c * 4) * 3"#,
            r#"hour("UTC") < 8 ? tier("night", p * 1 + c * 2) : tier("day", p * 2 + c * 4)"#,
            r#"tier("bad", p * -1 + c * 4)"#,
            r#"tier("bad", p * 1e999 + c * 4)"#,
            r#"tier("request", fixed(0.1))"#,
        ] {
            assert!(expression_tiers(expression, 1.0).is_none());
        }
    }
}
