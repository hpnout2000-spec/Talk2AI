import { removeBackground } from '@imgly/background-removal';

self.onmessage = async (e) => {
  try {
    const { dataUrl } = e.data;

    // Remove background. 
    // We pass the dataUrl which will be loaded as an image blob internally.
    const imageBlob = await fetch(dataUrl).then(r => r.blob());

    // Config: we use medium resolution for speed vs quality balance
    const config = {
      publicPath: 'https://static.remove-bg.ai/models/', // Use official CDN or local
      model: "medium", 
      output: {
        format: "image/png"
      }
    };

    const resultBlob = await removeBackground(imageBlob, config);

    const reader = new FileReader();
    reader.onloadend = () => {
      self.postMessage({ success: true, dataUrl: reader.result });
    };
    reader.onerror = () => {
      self.postMessage({ success: false, error: 'Failed to read result blob' });
    };
    reader.readAsDataURL(resultBlob);

  } catch (error) {
    self.postMessage({ success: false, error: error.message || String(error) });
  }
};
