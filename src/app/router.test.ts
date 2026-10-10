import { expect, it } from 'vitest';
import { parseRoute } from './router';
it('解析书架、设置与带编码的阅读路由；坏链接安全返回书架', () => {
  expect(parseRoute('#/about')).toEqual({ page: 'about' });
  expect(parseRoute('#/settings')).toEqual({ page: 'settings' });
  expect(parseRoute('#/settings/backup')).toEqual({
    page: 'settings',
    section: 'backup',
  });
  expect(parseRoute('#/read/a%20b')).toEqual({ page: 'reader', bookId: 'a b' });
  expect(parseRoute('#/read/%ZZ')).toEqual({ page: 'shelf' });
  expect(parseRoute('#/read/')).toEqual({ page: 'shelf' });
  expect(parseRoute('#/paste')).toEqual({ page: 'paste' });
  expect(parseRoute('#/paste/paste%3Aabc')).toEqual({
    page: 'paste',
    bookId: 'paste:abc',
  });
  expect(parseRoute('#/paste/%ZZ')).toEqual({ page: 'shelf' });
  expect(parseRoute('#/incoming')).toEqual({ page: 'incoming' });
  expect(parseRoute('#/incoming/uuid')).toEqual({
    page: 'incoming',
    id: 'uuid',
  });
  expect(parseRoute('#/paste-share/uuid')).toEqual({
    page: 'paste',
    incomingId: 'uuid',
  });
});
