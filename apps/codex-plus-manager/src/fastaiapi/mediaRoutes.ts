const imageGuidePath = "/hub/home/help/image-api/";

export function mediaRouteUrls(origin: string) {
  return {
    guide: new URL(imageGuidePath, origin).href,
    generateImage: new URL("/v1/images/generations", origin).href,
    editImage: new URL("/v1/images/edits", origin).href,
    submitVideo: new URL("/v1/videos", origin).href,
    testText: new URL("/v1/chat/completions", origin).href,
  };
}

export function withSelectedImageGuide(description: string, guide: string) {
  return description.replace(
    /https?:\/\/(?:fastaiapi\.cloud|newapi\.fastaiapi\.cloud|tumeiapi\.com|8\.137\.194\.180:90)(?:\/hub\/home)?\/help\/image-api\/?(?![\w/-])/g,
    guide,
  );
}
