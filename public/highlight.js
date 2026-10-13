(function(){
"use strict";
/* Syntax highlighting and language detection (VS Code Dark+ style colours live in style.css as .t-* classes). */
const KW = s => new Set(s.split(" "));
const LIT = KW("true false null undefined None True False nil NULL this self super");
const END = "(?![\\s\\S])";   // true end of input (not end of line)
const LANGS = {
  JavaScript:{kw:KW("var let const function return if else for while do switch case break continue new delete typeof instanceof in of class extends import export from default async await try catch finally throw yield static get set void with debugger"),lc:["//"],bc:true,q:"\"'`"},
  TypeScript:{kw:KW("var let const function return if else for while do switch case break continue new delete typeof instanceof in of class extends implements import export from default async await try catch finally throw yield static get set void interface type enum namespace public private protected readonly abstract declare as is keyof"),lc:["//"],bc:true,q:"\"'`"},
  Python:{kw:KW("def class return if elif else for while break continue pass import from as with try except finally raise lambda yield global nonlocal assert del in is not and or async await match case"),lc:["#"],q:"\"'",py:true},
  Java:{kw:KW("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var record"),lc:["//"],bc:true,q:"\"'"},
  C:{kw:KW("auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while"),lc:["//"],bc:true,q:"\"'",pp:true},
  "C++":{kw:KW("auto break case catch char class const constexpr continue default delete do double else enum explicit extern float for friend goto if inline int long namespace new noexcept nullptr operator private protected public register return short signed sizeof static struct switch template this throw try typedef typename union unsigned using virtual void volatile while bool override final"),lc:["//"],bc:true,q:"\"'",pp:true},
  "C#":{kw:KW("abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new object operator out override params private protected public readonly ref return sbyte sealed short sizeof static string struct switch this throw try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while async await record"),lc:["//"],bc:true,q:"\"'"},
  Go:{kw:KW("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var"),lc:["//"],bc:true,q:"\"'`"},
  Rust:{kw:KW("as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while"),lc:["//"],bc:true,q:"\"'"},
  PHP:{kw:KW("abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty extends final finally fn for foreach function global if implements include include_once instanceof interface isset list namespace new or print private protected public require require_once return static switch throw trait try unset use var while yield"),lc:["//","#"],bc:true,q:"\"'",dollar:true},
  Ruby:{kw:KW("alias and begin break case class def defined do else elsif end ensure for if in module next not or redo rescue retry return then undef unless until when while yield puts require"),lc:["#"],q:"\"'"},
  Swift:{kw:KW("associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as catch throw throws try async await"),lc:["//"],bc:true,q:"\"'"},
  Kotlin:{kw:KW("as break class continue do else for fun if in interface is object package return super this throw try typealias val var when while by catch constructor finally import init override open private protected public internal data sealed companion suspend"),lc:["//"],bc:true,q:"\"'"},
  SQL:{kw:KW("select from where insert into values update set delete create table alter drop index view join inner left right outer full on group by order having limit offset as and or not null is in like between distinct union all case when then else end primary key foreign references default unique constraint exists count sum avg min max asc desc"),lc:["--"],bc:true,q:"\"'",ci:true},
  Shell:{kw:KW("if then else elif fi for while until do done case esac in function select return exit export local readonly echo cd ls cat grep sed awk"),lc:["#"],q:"\"'`",dollar:true},
  YAML:{kw:KW(""),lc:[],q:"",yaml:true},
  Markdown:{kw:KW(""),lc:[],q:"",md:true},
  CSS:{kw:KW(""),lc:[],q:"",css:true},
  HTML:{kw:KW(""),lc:[],q:"",html:true},
  JSON:{kw:KW(""),lc:[],q:"",json:true},
  Other:{kw:KW("if else for while do return function class def var let const import from new try catch end begin then switch case break continue public private static void int string true false null"),lc:["//","#"],bc:true,q:"\"'"},
  Lua:{kw:KW("and break do else elseif end for function goto if in local not or repeat return then until while"),lc:["--"],q:"\"'"},
  "Plain text":null
};
const esc = s => s.replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
const wrapTok = (cls, s) => cls ? `<span class="t-${cls}">${esc(s)}</span>` : esc(s);
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
const DQ = "\"(?:\\\\.|[^\"\\\\\\n])*\"?";
const SQ = "'(?:\\\\.|[^'\\\\\\n])*'?";
const regexCache = {};

function buildRegex(name, cfg) {
  if (regexCache[name]) return regexCache[name];
  const parts = [], kinds = [];
  const add = (src, kind) => { parts.push("(" + src + ")"); kinds.push(kind); };
  if (cfg.html) {
    add("<!--[\\s\\S]*?(?:-->|" + END + ")", "com");
    add("<\\/?[A-Za-z][\\w:-]*", "tag");
    add("\\/?>", "tag");
    add("\"[^\"]*\"?|'[^']*'?", "str");
    add("[A-Za-z_:][\\w:.-]*(?=\\s*=)", "attr");
    add("&[#\\w]+;", "num");
  } else if (cfg.css) {
    add("\\/\\*[\\s\\S]*?(?:\\*\\/|" + END + ")", "com");
    add(DQ + "|" + SQ, "str");
    add("@[\\w-]+", "kw");
    add("#[0-9a-fA-F]{3,8}\\b", "num");
    add("-?\\d*\\.?\\d+(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?\\b", "num");
    add("--[\\w-]+|[A-Za-z-]+(?=\\s*:[^;{}]*[;}\\n])", "prop");
    add("[.#][A-Za-z_][\\w-]*", "type");
    add("[A-Za-z][\\w-]*(?=\\()", "fn");
  } else if (cfg.json) {
    add("\"(?:\\\\.|[^\"\\\\\\n])*\"(?=\\s*:)", "prop");
    add(DQ, "str");
    add("-?\\d+\\.?\\d*(?:[eE][+-]?\\d+)?", "num");
    add("\\b(?:true|false|null)\\b", "lit");
  } else if (cfg.yaml) {
    add("#.*", "com");
    add(DQ + "|'[^'\\n]*'?", "str");
    add("^[ \\t-]*[\\w.\\/-]+(?=\\s*:)", "prop");
    add("-?\\b\\d+\\.?\\d*\\b", "num");
    add("\\b(?:true|false|null|yes|no)\\b", "lit");
  } else if (cfg.md) {
    add("^#{1,6}[ \\t].*", "head");
    add("`{3}[\\s\\S]*?(?:`{3}|" + END + ")|`[^`\\n]*`?", "str");
    add("\\*\\*[^*\\n]+\\*\\*?|__[^_\\n]+__?", "kw");
    add("^[ \\t]*(?:[-*+]|\\d+\\.)[ \\t]", "num");
    add("\\[[^\\]\\n]*\\]\\([^)\\n]*\\)?", "fn");
  } else {
    if (cfg.bc) add("\\/\\*[\\s\\S]*?(?:\\*\\/|" + END + ")", "com");
    cfg.lc.forEach(c => add(reEsc(c) + ".*", "com"));
    if (cfg.pp) add("^[ \\t]*#[ \\t]*\\w+", "kw");
    if (cfg.py) add("\"{3}[\\s\\S]*?(?:\"{3}|" + END + ")|'{3}[\\s\\S]*?(?:'{3}|" + END + ")", "str");
    if (cfg.q.includes("`")) add("`(?:\\\\[\\s\\S]|[^`\\\\])*`?", "str");
    if (cfg.q.includes("\"")) add(DQ, "str");
    if (cfg.q.includes("'")) add(SQ, "str");
    add("\\b(?:0[xX][\\da-fA-F]+|\\d[\\d_]*\\.?\\d*(?:[eE][+-]?\\d+)?)\\b", "num");
    add((cfg.dollar ? "\\$?" : "") + "[A-Za-z_]\\w*", "word");
    add("[+\\-*/%=<>!&|^~?:]+", "op");
  }
  return regexCache[name] = { re: new RegExp(parts.join("|"), "gm"), kinds };
}

function highlight(code, name) {
  const cfg = LANGS[name];
  if (!cfg) return esc(code);
  const { re, kinds } = buildRegex(name, cfg);
  re.lastIndex = 0;
  let out = "", last = 0, m;
  while ((m = re.exec(code))) {
    if (m[0] === "") { re.lastIndex++; continue; }
    out += esc(code.slice(last, m.index));
    let kind = null;
    for (let i = 0; i < kinds.length; i++) if (m[i + 1] !== undefined) { kind = kinds[i]; break; }
    const text = m[0];
    if (kind === "word") {
      const bare = text.replace(/^\$/, ""), key = cfg.ci ? bare.toLowerCase() : bare;
      const next = code.slice(re.lastIndex, re.lastIndex + 40).match(/^\s*(.)/);
      if (cfg.kw.has(key)) kind = "kw";
      else if (LIT.has(bare)) kind = "lit";
      else if (next && next[1] === "(") kind = "fn";
      else if (/^[A-Z]\w*$/.test(bare) && /[a-z]/.test(bare)) kind = "type";
      else if (cfg.dollar && text[0] === "$") kind = "prop";
      else kind = null;
    } else if (kind === "op") kind = "op";
    out += wrapTok(kind, text);
    last = re.lastIndex;
  }
  return out + esc(code.slice(last));
}

/* Language detection: every language collects evidence (weighted patterns, some negative); the best score wins. */
const R = (re, w, cap) => [new RegExp(re.source, re.flags.replace("g", "") + "g"), w, cap || 1];
const JS_RULES = [
  R(/\b(const|let|var)\s+[\w${[]/, 3), R(/=>/, 2), R(/\bfunction\s*\*?\s*\w*\s*\(/, 3), R(/console\.(log|error|warn|info)\(/, 4),
  R(/\brequire\(|module\.exports|\bimport\s[^;\n]+\sfrom\s+['"]|\bexport\s+(default|const|function|class)\b/, 3),
  R(/===|!==/, 2), R(/\b(document|window)\.|addEventListener\(|\.querySelector/, 3), R(/\bnew Promise\b|\.then\(|\basync\s+function|\bawait\s/, 2),
  R(/^\s*(def|elif|end|fn|func|fun)\b/m, -4), R(/\bprint\(|:\s*$/m, -1)
];
const TS_ONLY = [
  R(/:\s*(string|number|boolean|any|void|unknown|never)\b(\[\])?/, 4, 2), R(/\binterface\s+\w+/, 4), R(/^\s*(export\s+)?type\s+\w+\s*=/m, 4),
  R(/\benum\s+\w+\s*\{/, 3), R(/\bas\s+(string|number|any|const|unknown)\b/, 3), R(/:\s*Promise<|<\w+(\[\])?>\s*\(|\bReadonly<|\bRecord</, 3), R(/\bimplements\s+\w+|\bprivate\s+\w+:|\breadonly\s/, 3)
];
const SIGS = {
  JavaScript: JS_RULES,
  TypeScript: JS_RULES.concat(TS_ONLY),
  Python: [
    R(/^\s*def\s+\w+\s*\(.*\)\s*(->\s*[^:]+)?:\s*$/m, 6), R(/^\s*class\s+\w+(\(.*\))?:\s*$/m, 6), R(/^\s*(elif\b.*:|except\b.*:|finally:|with\s+.+:|if\s+__name__)/m, 5),
    R(/^\s*(import\s+[\w.]+(\s+as\s+\w+)?\s*$|from\s+[\w.]+\s+import\b)/m, 4), R(/\bprint\(/, 3), R(/^\s*(for|while|if|else)\b[^;{}]*:\s*$/m, 3, 2),
    R(/\b(self|None|True|False)\b/, 2), R(/\blambda\s+\w*:|\bf["']|\bin\s+range\(/, 2), R(/[;{]\s*$/m, -4, 3), R(/\b(const|let|var|function|public|void)\b/, -3)
  ],
  Java: [
    R(/System\.out\.print/, 6), R(/public\s+static\s+void\s+main/, 7), R(/^\s*import\s+java\./m, 6), R(/\bString\[\]\s+\w+/, 4), R(/@Override|@Autowired|@Test\b/, 3),
    R(/\b(public|private|protected)\s+(static\s+)?(final\s+)?(class|interface|enum)\b/, 4), R(/\b(public|private|protected)\s+[\w<>\[\]]+\s+\w+\s*\(/, 2), R(/^\s*package\s+[\w.]+;/m, 3), R(/\bnew\s+\w+(<[^>]*>)?\(/, 1), R(/\bConsole\.|\busing\s+System/, -6)
  ],
  "C#": [
    R(/^\s*using\s+System/m, 7), R(/Console\.(Write|Read)/, 6), R(/\bnamespace\s+[\w.]+/, 3), R(/\{\s*get;\s*(set;|init;)?\s*\}/, 6), R(/\bstring\s+\w+\s*[=;]/, 2),
    R(/\b(public|private|internal)\s+(static\s+)?(async\s+)?(class|void|Task|string|int)\b/, 2), R(/\bforeach\s*\(\s*var\b|\bvar\s+\w+\s*=\s*new\b/, 3), R(/System\.out|import\s+java/, -6)
  ],
  C: [
    R(/#include\s*<(stdio|stdlib|string|math|stdint|stdbool)\.h>/, 7), R(/\bprintf\s*\(|\bscanf\s*\(/, 3), R(/\bint\s+main\s*\(/, 3), R(/\bmalloc\(|\bfree\(|\bsizeof\(/, 3),
    R(/\bstruct\s+\w+\s*\{/, 2), R(/\btypedef\b/, 3), R(/std::|\bcout\b|\bclass\b|\btemplate\s*</, -5)
  ],
  "C++": [
    R(/#include\s*<(iostream|vector|string|map|set|algorithm|memory|sstream)>/, 8), R(/std::/, 4), R(/\bcout\s*<<|\bcin\s*>>|\bendl\b/, 5), R(/\busing\s+namespace\s+std/, 5),
    R(/\btemplate\s*</, 4), R(/\bclass\s+\w+\s*(:\s*(public|private)\s+\w+)?\s*\{/, 3), R(/\bint\s+main\s*\(/, 3), R(/\bnullptr\b|\bauto\s+\w+\s*=/, 3), R(/\bconstexpr\b|\bvirtual\b/, 2)
  ],
  Go: [
    R(/^\s*package\s+\w+\s*$/m, 5), R(/\bfunc\s+(\(\w+\s+\*?\w+\)\s*)?\w+\s*\(/, 4), R(/:=/, 3), R(/\bfmt\.(Print|Sprint|Errorf|Fprint)/, 6), R(/^\s*import\s*\(/m, 4),
    R(/\bdefer\s|\bgo\s+func|\bchan\s/, 3), R(/\bgo\s+\w+\(/, 1), R(/\bfn\s|\blet\s+mut\b/, -4)
  ],
  Rust: [
    R(/\bfn\s+\w+\s*(<[^>]*>)?\s*\(/, 5), R(/\blet\s+mut\b/, 6), R(/\b(println|print|format|vec|panic|assert)!/, 6), R(/\bimpl\b|\btrait\s+\w+/, 3), R(/\buse\s+std::/, 6),
    R(/&mut\s|&'\w+|\bSome\(|\bNone\b|\bOk\(|\bErr\(/, 3), R(/\bpub\s+(fn|struct|enum|mod)\b/, 4), R(/->\s*(Result|Option|Self|\w+)\s*\{/, 2), R(/\bmatch\s+\w+.*\{/, 2), R(/\bfunc\s|:=/, -4)
  ],
  PHP: [R(/<\?php|<\?=/, 12), R(/\$\w+\s*=[^=]/, 3, 2), R(/\becho\s/, 2), R(/\$this->|->\w+\(/, 2), R(/\bnamespace\s+[\w\\]+;|\buse\s+[\w\\]+;/, 3)],
  Ruby: [
    R(/^\s*def\s+\w+[?!]?(\(.*\))?\s*$/m, 4), R(/^\s*end\s*$/m, 4, 2), R(/\bputs\s/, 4), R(/\brequire(_relative)?\s+['"]/, 3), R(/\|\w+(,\s*\w+)*\|/, 3), R(/\.each\s+do|\bdo\s*\|/, 4),
    R(/@\w+\s*=/, 2), R(/\battr_(accessor|reader|writer)\b/, 6), R(/^\s*class\s+\w+(\s*<\s*[\w:]+)?\s*$/m, 3), R(/\bnil\b.*\bthen\b|\blocal\s/, -3), R(/[;{]\s*$/m, -3, 2)
  ],
  Swift: [
    R(/\bimport\s+(UIKit|SwiftUI|Foundation|Combine)/, 8), R(/\bguard\s+let\b|\bif\s+let\b/, 5), R(/\bfunc\s+\w+\s*\(.*\)\s*(->\s*[\w?<>\[\]]+\s*)?\{/, 3), R(/\b(let|var)\s+\w+\s*:\s*[\w?<>\[\]]+/, 3),
    R(/@State|@Published|@ObservedObject|@main/, 6), R(/\bstruct\s+\w+\s*:\s*\w+/, 3), R(/\\\(\w+\)/, 3), R(/:=/, -4)
  ],
  Kotlin: [
    R(/\bfun\s+\w+\s*\(/, 6), R(/\bval\s+\w+/, 3), R(/\bdata\s+class\b/, 7), R(/\bprintln\(/, 2), R(/\bwhen\s*(\(.*\))?\s*\{/, 3), R(/^\s*import\s+(kotlin|android|java)/m, 4),
    R(/:\s*(Int|String|Boolean|Double|List<|MutableList<)\b/, 2), R(/\bobject\s+\w+|\bcompanion\s+object\b/, 4), R(/\bfunc\s/, -4)
  ],
  SQL: [
    R(/^\s*select\b/im, 4), R(/\bselect\b[\s\S]+\bfrom\b/i, 3), R(/^\s*(insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+(table|index|view|database)|alter\s+table|drop\s+table|truncate\s+table)\b/im, 7),
    R(/\b(where|group\s+by|order\s+by|having|inner\s+join|left\s+join|right\s+join|values\s*\(|limit\s+\d+)\b/i, 2, 3), R(/\b(primary\s+key|not\s+null|varchar\s*\(|auto_increment|foreign\s+key)\b/i, 3), R(/\bfunction\b|=>|\bconst\b/, -4)
  ],
  Shell: [
    R(/^#!.*\b(ba|z|da)?sh\b/, 12), R(/^\s*(echo|cd|ls|grep|sudo|apt(-get)?|npm|yarn|pip3?|git|chmod|chown|export|mkdir|rm|cp|mv|curl|wget|cat|source|docker)\s/m, 3, 3),
    R(/\$\{?\w+\}?|\$\(.*\)/, 2), R(/^\s*(fi|done|esac)\s*$|;\s*then\s*$|;\s*do\s*$/m, 3), R(/^\s*if\s+\[\[?\s/m, 4), R(/\|\s*(grep|awk|sed|xargs|sort|wc|head|tail)\b/, 3), R(/\bfunction\b.*\{|=>|\bconst\b/, -3)
  ],
  HTML: [
    R(/<!doctype html/i, 12), R(/<html[\s>]/i, 9), R(/<\/?(div|span|p|a|ul|ol|li|h[1-6]|body|head|section|nav|header|footer|main|button|form|input|label|table|tr|td|img|script|style|link|meta|title|br)\b[^>]*>/i, 3, 4), R(/<[a-z][\w-]*(\s+[\w:-]+(=("[^"]*"|'[^']*'|\w+))?)*\s*\/?>/i, 1, 2)
  ],
  CSS: [
    R(/(^|[\s}])[.#]?[\w*][\w\s.#:>+~,*\[\]="'-]*\{[^{}]*:[^{}]*\}/, 5), R(/@(media|import|keyframes|font-face|supports|charset)\b/, 5),
    R(/\b(color|background(-color)?|margin|padding|display|font(-size|-family)?|border(-radius)?|width|height|flex|grid|position)\s*:\s*[^;{}]+;?/, 3, 3), R(/:root\b|--[\w-]+\s*:/, 3), R(/<\w+|\bfunction\b|\bconst\b|=>/, -5)
  ],
  YAML: [R(/^---\s*$/m, 4), R(/^[\w.-]+:\s*(\S.*)?$/m, 2, 3), R(/^\s*-\s+[\w"'][^;{}]*$/m, 2, 2), R(/^\s+[\w.-]+:\s/m, 1), R(/[;{}]\s*$/m, -5), R(/\b(function|const|def|class)\b/, -3)],
  Markdown: [R(/^#{1,6}\s+\S/m, 4), R(/^\s*[-*]\s+\S/m, 1.5, 2), R(/\[[^\]]+\]\(https?:\/\/[^)]+\)/, 3), R(/^```/m, 4), R(/\*\*[^*\n]+\*\*|__[^_\n]+__/, 2), R(/^>\s+\S/m, 1.5), R(/^\s*\d+\.\s+\S/m, 1.5), R(/[;{}]\s*$/m, -3)],
  Lua: [
    R(/\blocal\s+\w+/, 4), R(/\bfunction\s+[\w.:]+\s*\(.*\)\s*$/m, 3), R(/\bthen\s*$|\bdo\s*$/m, 3, 2), R(/^\s*end\s*$/m, 2), R(/\bnil\b/, 3), R(/~=/, 4),
    R(/\bipairs\(|\bpairs\(|\btable\.(insert|concat|remove)|\bstring\.(format|sub|gsub)/, 4), R(/^\s*--(?!\[)/m, 1), R(/\bprint\(/, 1), R(/\bdef\s|\bputs\s|[;{]\s*$/m, -3)
  ]
};
const ORDER = ["JavaScript", "TypeScript", "Python", "Java", "C#", "C", "C++", "Go", "Rust", "PHP", "Ruby", "Swift", "Kotlin", "SQL", "Shell", "HTML", "CSS", "YAML", "Markdown", "Lua"];
function detectLanguage(code) {
  const t = String(code || "").slice(0, 20000).trim();
  if (!t) return "Plain text";
  if (/^[{[]/.test(t)) { try { JSON.parse(t); return "JSON"; } catch (e) { if (/^\{\s*"[^"]+"\s*:/.test(t)) return "JSON"; } }
  let best = "Plain text", bestScore = 2.99;
  for (const name of ORDER) {
    let score = 0;
    for (const [re, w, cap] of SIGS[name]) { re.lastIndex = 0; const n = (t.match(re) || []).length; if (n) score += w * Math.min(cap, n); }
    if (score > bestScore) { best = name; bestScore = score; }
  }
  return best;
}
window.CRHL = { LANGS, buildRegex, highlight, detectLanguage, esc };
})();
