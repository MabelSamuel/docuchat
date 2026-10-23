import { PDFParse } from 'pdf-parse'
import mammoth from 'mammoth'
import * as cheerio from 'cheerio'
import ExcelJS from 'exceljs'
import { Readable } from 'stream'

export type SupportedFormat =
  | 'text'
  | 'pdf'
  | 'markdown'
  | 'docx'
  | 'html'
  | 'xlsx'
  | 'csv';

export function detectFormat(filename: string): SupportedFormat {
  const ext = filename.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'txt':  return 'text';
    case 'md':   return 'markdown';
    case 'pdf':  return 'pdf';
    case 'docx': return 'docx';
    case 'html':
    case 'htm':  return 'html';
    case 'xlsx': return 'xlsx';
    case 'csv':  return 'csv';
    default:
      throw new Error(`Unsupported file format: .${ext}`);
  }
}

export async function extractText(
  content: Buffer | string,
  format: SupportedFormat
): Promise<{ text: string; pageCount?: number }> {
  switch (format) {
    case 'text':
      return {
        text: toUtf8(content),
      };

    case 'markdown':
      // Strip markdown formatting, keep the text
      return {
        text: stripMarkdown(toUtf8(content)),
      };

    case 'pdf': {
      const parser = new PDFParse({ data: toBuffer(content) });
      try {
        const parsed = await parser.getText();
        return {
          text: cleanExtractedText(parsed.text),
          pageCount: parsed.total,
        };
      } finally {
        await parser.destroy();
      }
    }

    case 'docx': {
      const result = await mammoth.extractRawText({ buffer: toBuffer(content) });
      return {
        text: cleanExtractedText(result.value),
      };
    }

    case 'html':
      return {
        text: cleanExtractedText(extractHtmlText(toUtf8(content))),
      };

    case 'xlsx':
    case 'csv': {
      const sheets = await extractSpreadsheetText(content, format);
      return {
        text: cleanExtractedText(sheets.text),
        pageCount: sheets.sheetCount,
      };
    }

    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

// Binary formats arrive as base64 when passed as a string
function toBuffer(content: Buffer | string): Buffer {
  return typeof content === 'string'
    ? Buffer.from(content, 'base64')
    : content;
}

function toUtf8(content: Buffer | string): string {
  return typeof content === 'string'
    ? content
    : content.toString('utf-8');
}

function extractHtmlText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe, svg, head').remove();

  // Put block elements on their own lines so text doesn't run together
  $('p, div, br, li, tr, h1, h2, h3, h4, h5, h6, section, article, header, footer, blockquote, pre')
    .each((_, el) => { $(el).append('\n'); });

  return $('body').length ? $('body').text() : $.root().text();
}

async function extractSpreadsheetText(
  content: Buffer | string,
  format: 'xlsx' | 'csv'
): Promise<{ text: string; sheetCount: number }> {
  const workbook = new ExcelJS.Workbook();

  if (format === 'csv') {
    await workbook.csv.read(Readable.from(toUtf8(content)));
  } else {
    // ExcelJS's Buffer type predates Node's generic Buffer
    await workbook.xlsx.load(toBuffer(content) as unknown as ArrayBuffer);
  }

  const sections: string[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[] = [];
    sheet.eachRow((row) => {
      const cells = (row.values as ExcelJS.CellValue[])
        .slice(1) // row.values is 1-indexed
        .map(cellToString)
        .filter(Boolean);
      if (cells.length) rows.push(cells.join(' | '));
    });
    if (rows.length) sections.push(`## ${sheet.name}\n${rows.join('\n')}`);
  });

  return { text: sections.join('\n\n'), sheetCount: workbook.worksheets.length };
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== 'object') return String(value).trim();
  if ('richText' in value) return value.richText.map((r) => r.text).join('');
  if ('text' in value) return String(value.text);           // Hyperlinks
  if ('result' in value) return cellToString(value.result as ExcelJS.CellValue); // Formulas
  if ('error' in value) return '';
  return '';
}

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, '')     // Headers
    .replace(/\*{1,3}(.*?)\*{1,3}/g, '$1')  // Bold/italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links
    .replace(/`{1,3}[^`]*`{1,3}/g, '')  // Code blocks
    .replace(/^[\-*+]\s+/gm, '')  // List markers
    .trim();
}

function cleanExtractedText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')       // Normalize line endings
    .replace(/[ \t]+\n/g, '\n')   // Trailing whitespace
    .replace(/\n{3,}/g, '\n\n')   // Collapse excessive newlines
    .replace(/[ \t]{2,}/g, ' ')   // Collapse excessive spaces
    .trim();
}
