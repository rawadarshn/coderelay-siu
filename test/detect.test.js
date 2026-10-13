global.window = {}; require("../public/highlight.js");
const d = window.CRHL.detectLanguage;
const cases = {
  JavaScript: ['console.log("hi")', 'const add = (a, b) => a + b;\nconsole.log(add(1,2));', 'function greet(name){\n  return "Hi " + name;\n}\ndocument.querySelector("#x").addEventListener("click", greet);', 'const express = require("express");\nconst app = express();', 'async function load(){ const r = await fetch("/x"); return r.json(); }'],
  TypeScript: ['interface User { name: string; age: number }\nconst u: User = { name: "a", age: 1 };', 'type Id = string | number;\nfunction f(x: Id): void {}', 'export class A implements B { private x: number = 1; }', 'enum Color { Red, Green }\nlet c: Color = Color.Red;'],
  Python: ['print("hello")', 'def add(a, b):\n    return a + b\n\nprint(add(1, 2))', 'import os\nfor f in os.listdir("."):\n    print(f)', 'class Dog:\n    def __init__(self, name):\n        self.name = name', 'if x > 3:\n    print("big")\nelse:\n    print("small")', 'numbers = [1,2,3]\nsquares = [n*n for n in numbers]\nprint(squares)'],
  Java: ['public class Main {\n  public static void main(String[] args) {\n    System.out.println("Hi");\n  }\n}', 'import java.util.*;\npublic class A { @Override public String toString(){ return "x"; } }'],
  "C#": ['using System;\nclass P { static void Main() { Console.WriteLine("Hi"); } }', 'namespace App {\n  public class User { public string Name { get; set; } }\n}'],
  C: ['#include <stdio.h>\nint main() {\n  printf("hi\\n");\n  return 0;\n}', '#include <stdlib.h>\nstruct node { int v; };\nint *p = malloc(sizeof(int));'],
  "C++": ['#include <iostream>\nusing namespace std;\nint main(){ cout << "hi" << endl; return 0; }', '#include <vector>\nstd::vector<int> v;\ntemplate <typename T> T id(T x){ return x; }'],
  Go: ['package main\n\nimport "fmt"\n\nfunc main() {\n  x := 5\n  fmt.Println(x)\n}'],
  Rust: ['fn main() {\n    let mut x = 5;\n    println!("{}", x);\n}', 'use std::collections::HashMap;\npub fn run() -> Result<(), String> { Ok(()) }'],
  PHP: ['<?php\n$name = "Ann";\necho "Hi $name";'],
  Ruby: ['def greet(name)\n  puts "Hi #{name}"\nend', 'class Dog\n  attr_accessor :name\nend', '[1,2,3].each do |n|\n  puts n\nend'],
  Swift: ['import SwiftUI\nstruct V: View { var body: some View { Text("hi") } }', 'let name: String = "a"\nguard let x = opt else { return }'],
  Kotlin: ['fun main() {\n  val x = 5\n  println(x)\n}', 'data class User(val name: String)'],
  SQL: ['select 1;', 'SELECT name, age FROM users WHERE age > 18 ORDER BY name;', 'CREATE TABLE t (id INT PRIMARY KEY, name VARCHAR(20) NOT NULL);', 'insert into users (name) values ("a");'],
  Shell: ['#!/bin/bash\necho "hi"', 'sudo apt-get update\ncd /tmp\nls -la | grep foo', 'if [ -f x ]; then\n  echo yes\nfi'],
  HTML: ['<!DOCTYPE html>\n<html><body><h1>Hi</h1></body></html>', '<div class="box">Testing text inside a box</div>', '<ul>\n  <li>One</li>\n  <li>Two</li>\n</ul>', '<button onclick="go()">Go</button>'],
  CSS: ['h1 { color: red; }', '.box {\n  padding: 24px;\n  border: 2px solid #d9303e;\n}', '@media (max-width: 600px) { body { margin: 0 } }', ':root { --red: #d9303e; }'],
  JSON: ['{"a": 1, "b": [1,2,3]}', '[1, 2, 3]', '{\n  "name": "x",\n  "version": "1.0.0"\n}'],
  YAML: ['name: app\nversion: 1\nitems:\n  - a\n  - b', '---\nkey: value\nother: 2'],
  Markdown: ['# Title\n\nSome **bold** text and a [link](https://x.com).\n\n- one\n- two'],
  Lua: ['local x = 5\nprint(x)', 'function add(a, b)\n  return a + b\nend\nfor i, v in ipairs(t) do print(v) end', 'if x ~= nil then\n  print("ok")\nend'],
  "Plain text": ['hello world', 'Meeting notes: call Sam at 5 and buy milk.', '']
};
let bad = 0, n = 0;
for (const [want, list] of Object.entries(cases)) for (const c of list) { n++; const got = d(c); if (got !== want) { bad++; console.log(`WRONG  want ${want.padEnd(10)} got ${got.padEnd(10)} | ${JSON.stringify(c.slice(0, 50))}`); } }
console.log(`${n - bad}/${n} samples detected correctly`);
process.exit(bad ? 1 : 0);
