const PATTERNS = [
  { name:'git-diff',  detect: s => s.includes('diff --git') || s.includes('--- a/'), fn: compressGitDiff },
  { name:'grep',      detect: s => /^\S+:\d+:/.test(s),                               fn: compressGrep  },
  { name:'ls-tree',   detect: s => /^(total \d+|drwx|lrwx|-rwx|-rw-)/.test(s) || s.includes('├──'), fn: compressTree },
  { name:'json-blob', detect: s => { try { const p=JSON.parse(s); return Array.isArray(p)&&p.length>10; } catch { return false; } }, fn: compressJSON },
];

function compressGitDiff(s) {
  const lines = s.split('\n');
  const out = []; let skipped = 0;
  for (const l of lines) {
    if (/^(diff |index |---|[+][+][+]|@@|[+-])/.test(l)) {
      if (skipped > 0) { out.push(`[…${skipped} context lines omitted]`); skipped=0; }
      out.push(l);
    } else skipped++;
  }
  if (skipped > 0) out.push(`[…${skipped} context lines omitted]`);
  return out.join('\n');
}
function compressGrep(s) {
  const lines = s.split('\n').filter(Boolean);
  if (lines.length <= 30) return s;
  return lines.slice(0,30).join('\n') + `\n[…${lines.length-30} more matches omitted]`;
}
function compressTree(s) {
  const lines = s.split('\n').filter(Boolean);
  if (lines.length <= 50) return s;
  return lines.slice(0,50).join('\n') + `\n[…${lines.length-50} entries omitted]`;
}
function compressJSON(s) {
  try {
    const obj = JSON.parse(s);
    if (Array.isArray(obj) && obj.length > 10) {
      return JSON.stringify(obj.slice(0,10), null, 2) + `\n// …${obj.length-10} more items`;
    }
    return JSON.stringify(obj, (k,v) => typeof v==='string'&&v.length>500?v.slice(0,500)+'…':v, 2);
  } catch { return s; }
}
function compressContent(s) {
  if (!s || s.length < 300) return s;
  for (const p of PATTERNS) if (p.detect(s)) return p.fn(s);
  if (s.length > 8000) return s.slice(0, 8000) + `\n[…${s.length-8000} chars omitted by RTK]`;
  return s;
}

function rtkCompress(messages) {
  if (!Array.isArray(messages)) return { messages, savedChars:0, hits:[] };
  let savedChars = 0; const hits = [];
  const processed = messages.map(msg => {
    if (!msg.content) return msg;
    if (Array.isArray(msg.content)) {
      const nc = msg.content.map(b => {
        if ((b.type==='tool_result'||b.type==='tool_use') && typeof b.content==='string') {
          const orig = b.content;
          const comp = compressContent(orig);
          if (comp !== orig) { savedChars += orig.length-comp.length; hits.push({ type:b.type, saved:orig.length-comp.length }); }
          return { ...b, content: comp };
        }
        return b;
      });
      return { ...msg, content: nc };
    }
    if (typeof msg.content==='string' && msg.role==='tool') {
      const orig = msg.content;
      const comp = compressContent(orig);
      if (comp !== orig) { savedChars += orig.length-comp.length; hits.push({ type:'tool', saved:orig.length-comp.length }); }
      return { ...msg, content: comp };
    }
    return msg;
  });
  return { messages: processed, savedChars, hits };
}

module.exports = { rtkCompress };
