// MXL文件处理（压缩的MusicXML）
import JSZip from 'jszip';

/**
 * 从MXL文件中提取MusicXML内容
 */
export async function extractMXL(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // MXL文件通常包含一个META-INF/container.xml文件
    // 它指向实际的MusicXML文件
    const containerFile = zip.file('META-INF/container.xml');
    
    if (containerFile) {
      // 解析container.xml找到主文件
      const containerContent = await containerFile.async('string');
      const mainFileName = extractMainFileName(containerContent);
      
      if (mainFileName) {
        const mainFile = zip.file(mainFileName);
        if (mainFile) {
          return await mainFile.async('string');
        }
      }
    }

    // 如果没有container.xml，尝试查找.xml文件
    const xmlFiles = Object.keys(zip.files).filter(name => 
      name.endsWith('.xml') && !name.startsWith('META-INF/')
    );

    if (xmlFiles.length > 0) {
      const mainFile = zip.file(xmlFiles[0]);
      if (mainFile) {
        return await mainFile.async('string');
      }
    }

    throw new Error('No MusicXML file found in MXL archive');
  } catch (error) {
    console.error('Failed to extract MXL:', error);
    throw new Error('Failed to extract MXL file');
  }
}

/**
 * 从container.xml中提取主文件名
 */
function extractMainFileName(containerXml: string): string | null {
  try {
    // 简单的正则表达式提取
    const match = containerXml.match(/full-path="([^"]+)"/);
    return match ? match[1] : null;
  } catch (error) {
    console.error('Failed to parse container.xml:', error);
    return null;
  }
}

/**
 * 检测文件类型
 */
export function getFileType(file: File): 'musicxml' | 'mxl' | 'unknown' {
  const extension = file.name.split('.').pop()?.toLowerCase();
  
  if (extension === 'musicxml' || extension === 'xml') {
    return 'musicxml';
  } else if (extension === 'mxl') {
    return 'mxl';
  }
  
  return 'unknown';
}

/**
 * 读取文件内容
 */
export async function readFileContent(file: File): Promise<string> {
  const fileType = getFileType(file);

  if (fileType === 'mxl') {
    return await extractMXL(file);
  } else if (fileType === 'musicxml') {
    return await file.text();
  } else {
    throw new Error('Unsupported file type. Please upload .musicxml or .mxl file');
  }
}

/**
 * 将 MusicXML 内容打包为 MXL（压缩）Blob，用于下载
 */
export async function createMXLBlob(xmlContent: string, innerFileName = 'score.musicxml'): Promise<Blob> {
  const zip = new JSZip();

  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container>
  <rootfiles>
    <rootfile full-path="${innerFileName}" media-type="application/vnd.recordare.musicxml+xml"/>
  </rootfiles>
</container>`;

  zip.file('META-INF/container.xml', containerXml);
  zip.file(innerFileName, xmlContent);

  return await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    mimeType: 'application/vnd.recordare.musicxml'
  });
}
