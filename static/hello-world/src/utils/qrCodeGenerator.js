// Standard compliant QR Code Generator for Test Pulse Suite
// Uses the official 'qrcode' engine for 100% reliable camera scanning on iOS and Android

import QRCode from 'qrcode';

/**
 * Generates an SVG string representation of a QR Code
 * @param {string} text - URL or text to encode
 * @param {object} options - { size = 280, margin = 4, darkColor = '#000000', lightColor = '#FFFFFF' }
 * @returns {Promise<string>} SVG string
 */
export async function generateQrSvg(text, options = {}) {
  const size = options.size || 280;
  const margin = options.margin !== undefined ? options.margin : 4;
  const darkColor = options.darkColor || '#000000';
  const lightColor = options.lightColor || '#FFFFFF';

  return new Promise((resolve, reject) => {
    QRCode.toString(
      text,
      {
        type: 'svg',
        width: size,
        margin: margin,
        color: {
          dark: darkColor,
          light: lightColor
        },
        errorCorrectionLevel: 'M'
      },
      (err, svgString) => {
        if (err) return reject(err);
        resolve(svgString);
      }
    );
  });
}

/**
 * Generates a high-contrast PNG Data URL of a QR Code
 * @param {string} text - URL or text to encode
 * @param {object} options - { size = 280, margin = 4, darkColor = '#000000', lightColor = '#FFFFFF' }
 * @returns {Promise<string>} data:image/png;base64,...
 */
export async function generateQrDataUrl(text, options = {}) {
  const size = options.size || 280;
  const margin = options.margin !== undefined ? options.margin : 4;
  const darkColor = options.darkColor || '#000000';
  const lightColor = options.lightColor || '#FFFFFF';

  return new Promise((resolve, reject) => {
    QRCode.toDataURL(
      text,
      {
        width: size,
        margin: margin,
        color: {
          dark: darkColor,
          light: lightColor
        },
        errorCorrectionLevel: 'M'
      },
      (err, dataUrl) => {
        if (err) return reject(err);
        resolve(dataUrl);
      }
    );
  });
}

export default generateQrSvg;
