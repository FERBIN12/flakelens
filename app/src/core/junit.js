/**
 * Minimal, dependency-free JUnit XML parser.
 *
 * CI systems (GitHub Actions, Jenkins, GitLab, pytest --junitxml, Jest junit reporter, Maven Surefire)
 * all emit roughly the same shape:
 *
 *   <testsuites>
 *     <testsuite name="..." tests="3" failures="1">
 *       <testcase classname="pkg.Class" name="test_a" time="0.12"/>
 *       <testcase classname="pkg.Class" name="test_b"><failure message="boom">stack</failure></testcase>
 *       <testcase classname="pkg.Class" name="test_c"><skipped/></testcase>
 *     </testsuite>
 *   </testsuites>
 *
 * We only need test identity, outcome, duration and the first line of the failure message, so a small
 * tag scanner is enough and keeps the Forge bundle tiny. We never evaluate the XML (no entities beyond
 * the five standard ones, no DTDs), which also avoids XXE-style surprises from untrusted CI input.
 */

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };

/** Decode the five XML entities plus numeric character references. */
export function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&(lt|gt|amp|quot|apos);/g, (m) => ENTITIES[m]);
}

/** Parse `key="value"` pairs from the inside of a start tag. */
export function parseAttributes(attrText) {
  const attrs = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(attrText)) !== null) {
    attrs[m[1]] = decodeEntities(m[3] !== undefined ? m[3] : m[4]);
  }
  return attrs;
}

/**
 * Short failure summary: the first two non-empty lines joined (assertion libraries often put the headline on line 1
 * and the actual values on line 2, e.g. "Expected values to be strictly equal:" / "'west' !== 'east'"), capped.
 */
function firstLine(text, max = 300) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  let line = lines[0] || '';
  if (lines[1] && line.endsWith(':')) line = `${line} ${lines[1]}`;
  return line.length > max ? `${line.slice(0, max - 3)}...` : line;
}

/**
 * Parse a JUnit XML document into a flat list of test results.
 * @param {string} xml
 * @returns {{id:string, suite:string, classname:string, name:string, status:'pass'|'fail'|'error'|'skip', time:number, message:string}[]}
 */
export function parseJUnit(xml) {
  if (typeof xml !== 'string' || !xml.includes('<testcase')) {
    throw new Error('Not a JUnit XML report: no <testcase> elements found');
  }
  // Strip comments and CDATA wrappers (keep CDATA text: it is usually the stack trace).
  const doc = xml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner) => inner.replace(/</g, '&lt;').replace(/>/g, '&gt;'));

  const results = [];
  // Track the innermost open <testsuite name> so ids stay unique across suites without classname.
  const suiteStack = [];
  const tagRe = /<(\/?)(testsuite|testcase)\b([^>]*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(doc)) !== null) {
    const [, closing, tag, attrText, selfClosing] = m;
    if (tag === 'testsuite') {
      if (closing) suiteStack.pop();
      else if (!selfClosing) suiteStack.push(parseAttributes(attrText).name || '');
      continue;
    }
    if (closing) continue; // </testcase> handled by the body scan below
    const attrs = parseAttributes(attrText);
    let body = '';
    if (!selfClosing) {
      const end = doc.indexOf('</testcase>', tagRe.lastIndex);
      body = end === -1 ? '' : doc.slice(tagRe.lastIndex, end);
      if (end !== -1) tagRe.lastIndex = end + '</testcase>'.length;
    }
    let status = 'pass';
    let message = '';
    const outcome = /<(failure|error|skipped)\b([^>]*?)(\/?)>([\s\S]*?)(?:<\/\1>|$)/.exec(body);
    if (outcome) {
      const kind = outcome[1];
      status = kind === 'failure' ? 'fail' : kind === 'error' ? 'error' : 'skip';
      const oAttrs = parseAttributes(outcome[2]);
      const inner = outcome[3] ? '' : decodeEntities(outcome[4] || '');
      message = firstLine(oAttrs.message || inner || oAttrs.type || kind);
    }
    const suite = suiteStack[suiteStack.length - 1] || '';
    // Node's built-in reporter writes classname="test" plus a file="..." path: use the file's basename instead
    // (never the full path, which would leak the CI machine's directory layout into storage).
    const fileBase = attrs.file ? attrs.file.split(/[\\/]/).pop() : '';
    const genericClass = !attrs.classname || attrs.classname === 'test';
    const classname = (genericClass && fileBase) || attrs.classname || attrs.class || suite;
    const name = attrs.name || '(unnamed)';
    results.push({
      id: classname ? `${classname}::${name}` : name,
      suite,
      classname,
      name,
      status,
      time: Number.isFinite(parseFloat(attrs.time)) ? parseFloat(attrs.time) : 0,
      message,
    });
  }
  return results;
}
