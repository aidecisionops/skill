import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const helper = path.resolve(import.meta.dir,"../decision-ops/scripts/read-manifest.sh");
test("manifest helper parses real TOML comments, literal strings and escapes without leaking custom fields", () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"decisionops-manifest-"));
  try {
    fs.mkdirSync(path.join(root,".decisionops"));
    fs.writeFileSync(path.join(root,".decisionops/manifest.toml"),`version = 1
org_id = 'org-real' # organization
project_id = "project-real" # selected project
repo_ref = "acme/payments"
custom_secret = "must-not-appear"
`);
    const result=spawnSync("bash",[helper,root],{encoding:"utf8"});
    expect(result.status).toBe(0);
    const output=JSON.parse(result.stdout);
    expect(output.org_id).toBe("org-real");
    expect(output.project_id).toBe("project-real");
    expect(result.stdout).not.toContain("must-not-appear");
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test("manifest helper rejects duplicate keys and unsupported versions without a success payload", () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"decisionops-manifest-"));
  try {
    fs.mkdirSync(path.join(root,".decisionops"));
    for (const content of ['org_id="a"\norg_id="b"\nproject_id="p"\nrepo_ref="o/r"\n','version=2\norg_id="a"\nproject_id="p"\nrepo_ref="o/r"\n']) {
      fs.writeFileSync(path.join(root,".decisionops/manifest.toml"),content);
      const result=spawnSync("bash",[helper,root],{encoding:"utf8"});
      expect(result.status).not.toBe(0);expect(result.stdout).toBe("");
    }
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
