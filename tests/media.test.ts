import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './test-config.js';
import { MediaPipeline } from '../src/media.js';

describe('MediaPipeline', () => {
  it('extracts text from an already downloaded text attachment', async () => {
    const pipeline = new MediaPipeline(loadConfig({
      NODE_ENV: 'test',
      DINGTALK_ROBOT_CODE: 'robot',
      MEDIA_DIR: resolve('tests/.tmp-media')
    }));
    const result = await pipeline.prepare('request-1', [{
      id: 'attachment-1',
      name: 'sample.txt',
      sourceType: 'file',
      localPath: resolve('tests/fixtures/sample.txt'),
      contentType: 'text/plain'
    }]);
    expect(result[0]?.extractedText).toContain('附件解析测试');
  });
});
