/**
 * 판매현황 배달부 (Google Apps Script)
 * ------------------------------------------------------------------
 * 구글 드라이브 폴더에 있는 판매현황 파일을 읽어 대시보드에 그대로 넘겨준다.
 * 드라이브에 파일만 덮어쓰면 대시보드가 알아서 최신 내용을 받아간다.
 *
 * 최초 1회
 *   1) script.google.com → 새 프로젝트 → 이 코드를 전부 붙여넣고 저장
 *   2) 함수 목록에서 [설정] 을 골라 실행 (구글 권한 승인 필요)
 *      → 실행 로그에 "폴더 주소" 와 "열쇠" 가 나온다
 *   3) 배포 → 새 배포 → 유형: 웹 앱
 *        실행 계정: 나
 *        액세스 권한: 모든 사용자          ← 열쇠로 막으므로 이렇게 둬야 한다
 *      → 배포 후 나오는 웹 앱 URL 복사
 *   4) 대시보드 [🔗 드라이브 연결] 에 URL 과 열쇠를 붙여넣기
 *
 * 그다음부터는 드라이브 폴더에 판매현황 파일을 덮어쓰기만 하면 된다.
 *
 * 주의: 열쇠는 이 스크립트 속성에만 있고 대시보드 저장소에는 없다.
 *       열쇠가 없으면 URL 을 알아도 아무것도 받아갈 수 없다.
 */

// 판매 파일이 들어 있는 폴더. 하위 폴더까지 뒤지므로 맨 위 폴더를 적으면 된다.
// 폴더 ID 를 직접 넣어도 된다(드라이브 주소 .../folders/여기부분).
var FOLDER_NAME = 'ERP 자료(판매/구매)';
var FOLDER_ID = '';                                  // 이름으로 못 찾을 때만 쓴다
var FOLDER_ALT = ['판매량', '구매요청 ERP 자료'];      // 예전 이름들
var P = PropertiesService.getScriptProperties();

/** 최초 1회 실행 — 폴더를 찾고 열쇠를 만든다 */
function 설정() {
  var f = 폴더_();
  var key = P.getProperty('SALES_KEY');
  if (!key) { key = Utilities.getUuid().replace(/-/g, ''); P.setProperty('SALES_KEY', key); }

  var picked = '';
  try {
    var hits = 판매파일들_(f);
    picked = hits.length
      ? '\n' + hits.map(function (x) {
          return '  · ' + x.getName() + '  [' + 회사_(x.getName()) + ']  (' + 날짜_(x.getLastUpdated()) + ' 수정)';
        }).join('\n')
      : ' 못 찾음';
  } catch (e) { picked = ' 확인 실패 — ' + e.message; }

  var m = '[준비 끝]\n\n폴더 : ' + f.getName() + '\n       ' + f.getUrl()
        + '\n\n폴더 안의 파일 :\n  · ' + 폴더안_(f).join('\n  · ')
        + '\n\n읽을 판매 파일 ' + (picked.indexOf('\n') === 0 ? '(' + 판매파일들_(f).length + '개) :' : ':') + picked
        + '\n\n열쇠 : ' + key
        + '\n\n이제 [배포 → 새 배포 → 웹 앱] 으로 배포하고,'
        + '\n웹 앱 URL 과 위 열쇠를 대시보드에 넣으세요.';
  Logger.log(m);
  return m;
}

/** 열쇠를 새로 만든다(유출됐을 때). 대시보드에 새 열쇠를 다시 넣어야 한다. */
function 열쇠_새로만들기() {
  var key = Utilities.getUuid().replace(/-/g, '');
  P.setProperty('SALES_KEY', key);
  Logger.log('새 열쇠 : ' + key + '\n\n대시보드에 다시 넣어주세요. 이전 열쇠는 즉시 막힙니다.');
  return key;
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.key !== P.getProperty('SALES_KEY')) return 응답_(p.callback, { ok: false, error: '열쇠가 맞지 않습니다.' });

    var f = 폴더_();
    var files = 판매파일들_(f);
    if (!files.length) {
      // 왜 못 찾았는지 알 수 있게 폴더에 뭐가 있는지 그대로 알려준다
      var 전부 = 폴더안_(f);
      return 응답_(p.callback, { ok: false, error:
        '폴더에서 판매현황 파일을 찾지 못했습니다.\n\n' +
        '폴더: ' + f.getName() + '\n' +
        (전부.length ? '안에 있는 파일 ' + 전부.length + '개:\n · ' + 전부.join('\n · ')
                     : '폴더가 비어 있습니다.') +
        '\n\n판매 자료 파일 이름에 "판매" 나 "매출" 이 들어가야 합니다.' });
    }

    // 파일 목록과 수정시각 = 바뀌었는지 판단하는 지문
    var list = files.map(function (x) {
      return { name: x.getName(), company: 회사_(x.getName()), updated: x.getLastUpdated().getTime() };
    });
    var meta = { ok: true, folder: f.getUrl(), files: list, 지문: 지문_(list) };
    if (p.sales === 'meta') return 응답_(p.callback, meta);          // 바뀌었는지만 싸게 확인

    // 파일마다 열 구성이 다를 수 있으므로 합치지 않고 따로 넘긴다.
    // (대시보드가 파일별로 열을 인식한 뒤 합친다)
    var out = [], total = 0;
    for (var i = 0; i < files.length; i++) {
      var rows = 행읽기_(files[i]);
      if (!rows || !rows.length) continue;
      total += rows.length - 1;
      out.push({ name: list[i].name, company: list[i].company, updated: list[i].updated, rows: rows });
    }
    if (!out.length) return 응답_(p.callback, { ok: false, error: '파일에서 읽을 내용이 없습니다.' });
    meta.data = out;
    meta.n = total;
    return 응답_(p.callback, meta);
  } catch (err) {
    return 응답_(p.callback, { ok: false, error: String(err && err.message || err) });
  }
}

/* ---------- 폴더 · 파일 찾기 ---------- */
function 폴더_() {
  if (FOLDER_ID) { try { return DriveApp.getFolderById(FOLDER_ID); } catch (e) {} }
  var id = P.getProperty('SALES_FOLDER');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var names = [FOLDER_NAME].concat(FOLDER_ALT);
  for (var i = 0; i < names.length; i++) {
    var it = DriveApp.getFoldersByName(names[i]);
    if (it.hasNext()) { var f = it.next(); P.setProperty('SALES_FOLDER', f.getId()); return f; }
  }
  throw new Error('"' + FOLDER_NAME + '" 폴더를 찾지 못했습니다.\n' +
                  '스크립트 맨 위 FOLDER_NAME 을 실제 폴더 이름으로 고치거나,\n' +
                  'FOLDER_ID 에 폴더 주소의 /folders/ 뒤 부분을 넣어주세요.');
}

/** 폴더와 그 하위 폴더를 모두 훑어 파일을 모은다.
 *  판매 파일을 "판매량" 같은 하위 폴더에 정리해 두어도 찾아내기 위함이다. */
function 모든파일_(folder, depth, acc, seenFolder) {
  acc = acc || []; depth = depth == null ? 4 : depth; seenFolder = seenFolder || {};
  var fid = folder.getId();
  if (seenFolder[fid] || acc.length > 500) return acc;
  seenFolder[fid] = 1;
  var it = folder.getFiles();
  while (it.hasNext() && acc.length <= 500) acc.push(it.next());
  if (depth > 0) {
    var subs = folder.getFolders();
    while (subs.hasNext()) 모든파일_(subs.next(), depth - 1, acc, seenFolder);
  }
  return acc;
}

/** 이름에 판매·매출이 들어간 파일을 "전부" 고른다.
 *  회사·연도별로 여러 개를 넣어두면(태성정밀 25년 / 플로우텍 26년 …) 모두 합쳐 본다. */
function 판매파일들_(folder) {
  var all = 모든파일_(folder), hit = [], seen = {};
  for (var i = 0; i < all.length; i++) {
    var f = all[i], nm = f.getName();
    if (nm.charAt(0) === '~') continue;                                  // 엑셀 임시파일
    if (!표파일_(f)) continue;
    if (!/판매|매출|sales/i.test(nm)) continue;                           // 판매 자료만
    if (/재고|bom|소요량|품목등록|기준정보|구매요청/i.test(nm)) continue;   // 다른 용도
    if (seen[nm]) continue;                                              // 같은 이름 중복 합산 방지
    seen[nm] = 1;
    hit.push(f);
  }
  hit.sort(function (a, b) { return a.getName() < b.getName() ? -1 : 1; });
  return hit;
}

/** 폴더와 하위 폴더에 뭐가 들었는지 (진단용) */
function 폴더안_(folder) {
  var all = 모든파일_(folder), out = [];
  for (var i = 0; i < all.length && out.length < 40; i++) {
    var f = all[i];
    out.push(f.getName() + '   [' + (표파일_(f) ? '표' : f.getMimeType()) + ']');
  }
  return out;
}

/** 읽을 수 있는 표 파일인가 — 확장자가 없는 구글시트도 포함 */
function 표파일_(f) {
  var nm = f.getName(), mt = f.getMimeType();
  return /\.(xlsx|csv|tsv|txt)$/i.test(nm)
      || mt === 'application/vnd.google-apps.spreadsheet'
      || mt === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      || mt === 'text/csv' || mt === 'text/plain';
}

/** 파일 이름에서 회사를 뽑는다. "태성정밀 26년 판매량.xlsx" → "태성정밀"
 *  연도가 앞에 와도("25년 태성정밀 판매량"), 붙여 써도("태성정밀25년판매량"),
 *  법인 표기가 있어도("태성정밀(주)") 같은 회사로 묶이게 한다. */
function 회사_(name) {
  var s = String(name).replace(/\.[^.]+$/, '');            // 확장자 제거
  s = s.replace(/㈜|\(주\)|\(株\)|주식회사/g, ' ');         // 법인 표기 제거 — 안 하면 따로 집계된다
  var parts = s.split(/[\s_\-·,()\[\]]+/);
  for (var i = 0; i < parts.length; i++) {
    var t = parts[i];
    if (!t) continue;
    if (/^\d+\s*년?$/.test(t)) continue;                   // 23년 · 2026 같은 연도 토막
    t = t.replace(/(판매량|판매현황|판매내역|판매|매출현황|매출|내역|현황)/g, '');
    t = t.replace(/\d+\s*년?$/, '').trim();                // "태성정밀25년" 처럼 꼬리에 붙은 연도
    if (t) return t;
  }
  return '(미지정)';
}

/** 파일 목록 + 수정시각을 한 줄로 — 이게 바뀌면 다시 받는다 */
function 지문_(list) {
  return list.map(function (x) { return x.name + '@' + x.updated; }).join('|');
}

/* ---------- 파일 읽기 (구매요청 대시보드와 같은 방식) ---------- */
function 행읽기_(f) {
  var mt = f.getMimeType(), nm = f.getName(), low = nm.toLowerCase();
  if (mt === 'application/vnd.google-apps.spreadsheet')
    return SpreadsheetApp.openById(f.getId()).getSheets()[0].getDataRange().getDisplayValues();
  if (/\.(csv|tsv|txt)$/.test(low) || mt === 'text/csv' || mt === 'text/plain')
    return Utilities.parseCsv(f.getBlob().getDataAsString('UTF-8').replace(/^﻿/, ''));
  if (/\.xlsx$/.test(low) || mt === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    return xlsx_(f.getBlob());
  if (/\.xls$/.test(low)) throw new Error('옛 .xls 형식입니다 — .xlsx 나 CSV 로 저장해 주세요');
  throw new Error('읽을 수 없는 형식입니다: ' + nm);
}

// .xlsx 는 zip 이다. 드라이브 변환을 거치지 않고 여기서 바로 풀어 읽는다.
function xlsx_(blob) {
  var parts;
  try { parts = Utilities.unzip(blob.setContentType('application/zip')); }
  catch (e) { throw new Error('엑셀 파일을 여는 데 실패했습니다 — CSV 로 저장해 올려주세요'); }
  var map = {};
  for (var i = 0; i < parts.length; i++) map[parts[i].getName()] = parts[i];
  var get = function (n) { return map[n] ? map[n].getDataAsString('UTF-8') : ''; };

  // 공유 문자열
  var shared = [], ssx = get('xl/sharedStrings.xml');
  if (ssx) {
    var si = /<si\b[^>]*>([\s\S]*?)<\/si>/g, m;
    while ((m = si.exec(ssx))) {
      var s = '', t = /<t\b[^>]*>([\s\S]*?)<\/t>/g, x;
      while ((x = t.exec(m[1]))) s += x[1];
      shared.push(unesc_(s));
    }
  }
  // 날짜 서식 (cellStyleXfs 가 아니라 cellXfs 안의 xf 만)
  var dateStyle = [], stx = get('xl/styles.xml');
  if (stx) {
    var fmt = {}, fr = /<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g, f2;
    while ((f2 = fr.exec(stx))) fmt[f2[1]] = unesc_(f2[2]);
    var isDate = function (id) {
      var k = +id; if ((k >= 14 && k <= 22) || (k >= 45 && k <= 47)) return true;
      var c = fmt[id];
      return c ? /[dmy]/i.test(c.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '')) : false;
    };
    var cx = stx.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/);
    if (cx) { var xr = /<xf\b[^>]*>/g, xx, i2 = 0;
      while ((xx = xr.exec(cx[0]))) { var id = (xx[0].match(/numFmtId="(\d+)"/) || [])[1] || '0'; dateStyle[i2++] = isDate(id); } }
  }
  var names = [];
  for (var k in map) if (/^xl\/worksheets\/sheet\d+\.xml$/.test(k)) names.push(k);
  if (!names.length) throw new Error('워크시트를 찾을 수 없습니다');
  names.sort();

  var xml = get(names[0]), rows = [];
  var rr = /<row\b[^>]*>([\s\S]*?)<\/row>/g, cr = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, r;
  while ((r = rr.exec(xml))) {
    var cells = [], c; cr.lastIndex = 0;
    while ((c = cr.exec(r[1]))) {
      var at = c[1] || '', body = c[2] || '';
      var ref = (at.match(/r="([A-Z]+)/) || [])[1] || '';
      var tt = (at.match(/t="([^"]*)"/) || [])[1] || '';
      var st = (at.match(/s="(\d+)"/) || [])[1];
      var col; if (ref) { col = 0; for (var q = 0; q < ref.length; q++) col = col * 26 + (ref.charCodeAt(q) - 64); col--; } else col = cells.length;
      var val = '';
      if (tt === 's') { var v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1]; val = shared[+v] || ''; }
      else if (tt === 'inlineStr') { var s2 = '', tr = /<t\b[^>]*>([\s\S]*?)<\/t>/g, tm;
        while ((tm = tr.exec(body))) s2 += tm[1]; val = unesc_(s2); }
      else { var v2 = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        var raw = (v2 == null) ? '' : unesc_(v2);
        val = (raw !== '' && st != null && dateStyle[+st]) ? serial_(+raw) : raw; }
      cells[col] = val;
    }
    for (var j = 0; j < cells.length; j++) if (cells[j] == null) cells[j] = '';
    rows.push(cells);
  }
  return rows;
}

function unesc_(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, function (m, e) {
    if (e === 'lt') return '<'; if (e === 'gt') return '>'; if (e === 'amp') return '&';
    if (e === 'quot') return '"'; if (e === 'apos') return "'";
    if (e.charAt(0) === '#') { var n = e.charAt(1) === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1);
      return isFinite(n) ? String.fromCharCode(n) : m; }
    return m;
  });
}
function serial_(n) {
  var d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}
function 날짜_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'); }

/* ---------- 응답 ----------
 * 브라우저가 CORS 로 막는 경우를 대비해 JSONP(callback) 도 함께 지원한다. */
function 응답_(callback, obj) {
  var body = JSON.stringify(obj);
  if (callback) return ContentService.createTextOutput(callback + '(' + body + ')')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}
