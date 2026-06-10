import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';

// Configure pdfjs worker source using local bundled script.
// MV3 extension CSP blocks external CDN scripts from running in workers.
pdfjsLib.GlobalWorkerOptions.workerSrc = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL
  ? chrome.runtime.getURL('pdf.worker.min.mjs')
  : '/pdf.worker.min.mjs';

/**
 * Extracts plain text from a PDF file provided as an ArrayBuffer.
 */
export async function parsePdf(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    const uint8Array = new Uint8Array(arrayBuffer);
    const loadingTask = pdfjsLib.getDocument({
      data: uint8Array,
      useSystemFonts: true,
      disableFontFace: true,
    });
    
    const pdf = await loadingTask.promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str || '')
        .join(' ');
      fullText += pageText + '\n';
    }
    
    return fullText.trim();
  } catch (error) {
    console.error('PDF parsing error:', error);
    throw new Error('Failed to parse PDF. Please ensure the file is not password protected or corrupted.');
  }
}

/**
 * Extracts plain text from a DOCX file provided as an ArrayBuffer.
 */
export async function parseDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value.trim();
  } catch (error) {
    console.error('DOCX parsing error:', error);
    throw new Error('Failed to parse Word document. Please ensure it is a valid .docx file.');
  }
}
