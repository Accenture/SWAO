// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3574: a minimal XML reader for the AWS Query and EC2 protocols (STS, IAM,
// EC2, RDS responses and their `<ErrorResponse>` / `<Response><Errors>`
// envelopes). Elements, text and the five predefined entities plus numeric
// character references; attributes, comments, processing instructions and
// CDATA are skipped or kept as text. No dependency is added for this
// (module-landing-zone/package.json has none for XML).

export interface XmlNode {
  name: string;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: '#root', children: [], text: '' };
  const stack: XmlNode[] = [root];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) (stack[stack.length - 1] as XmlNode).text += decode(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt); i = e < 0 ? src.length : e + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt);
      (stack[stack.length - 1] as XmlNode).text += src.slice(lt + 9, e < 0 ? src.length : e);
      i = e < 0 ? src.length : e + 3;
      continue;
    }
    const gt = src.indexOf('>', lt);
    if (gt < 0) throw new Error('unterminated XML tag');
    const tag = src.slice(lt + 1, gt);
    i = gt + 1;
    if (tag.startsWith('?') || tag.startsWith('!')) continue;
    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim();
      const top = stack.pop();
      if (!top || top.name !== name) throw new Error(`XML close tag </${name}> does not match <${top?.name ?? ''}>`);
      continue;
    }
    const selfClosing = tag.endsWith('/');
    const name = (selfClosing ? tag.slice(0, -1) : tag).trim().split(/\s+/)[0] as string;
    const node: XmlNode = { name, children: [], text: '' };
    (stack[stack.length - 1] as XmlNode).children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length !== 1) throw new Error(`unclosed XML element <${(stack[stack.length - 1] as XmlNode).name}>`);
  return root;
}

/** First descendant (depth-first) with the given name. */
export function find(node: XmlNode, name: string): XmlNode | undefined {
  for (const c of node.children) {
    if (c.name === name) return c;
    const d = find(c, name);
    if (d) return d;
  }
  return undefined;
}

/** Direct children with the given name. */
export function kids(node: XmlNode | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((c) => c.name === name) : [];
}

/** Text of the first direct child with the given name. */
export function textOf(node: XmlNode | undefined, name: string): string | undefined {
  const c = node?.children.find((x) => x.name === name);
  return c ? c.text.trim() : undefined;
}

/** `<Code>` of an AWS XML error envelope, if the document is one. */
export function xmlErrorCode(doc: XmlNode): string | undefined {
  const err = find(doc, 'Error');
  return err ? textOf(err, 'Code') : undefined;
}
