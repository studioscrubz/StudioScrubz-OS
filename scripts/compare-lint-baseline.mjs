import { ESLint } from 'eslint';
import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';
import { writeFileSync } from 'node:fs';

const baselineRef = process.argv[2] || 'origin/main';
const eslint = new ESLint();
const current = await eslint.lintFiles(['.']);
const signature = message => `${message.ruleId || 'parser'}:${message.message}`;
const report = { baselineRef, baselineSha: execFileSync('git', ['rev-parse', baselineRef], { encoding: 'utf8' }).trim(), currentErrors: 0, preExistingErrors: 0, introducedErrors: [], resolvedErrors: [], files: [] };
for (const result of current) {
  const path = relative(process.cwd(), result.filePath).replaceAll('\\', '/');
  const errors = result.messages.filter(m => m.severity === 2);
  let source;
  try { source = execFileSync('git', ['show', `${baselineRef}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { source = null; }
  const baseline = source == null ? [] : (await eslint.lintText(source, { filePath: result.filePath }))[0]?.messages.filter(m => m.severity === 2) || [];
  const counts = new Map();
  for (const m of baseline) counts.set(signature(m), (counts.get(signature(m)) || 0) + 1);
  for (const m of errors) {
    report.currentErrors++;
    const key = signature(m);
    if (counts.get(key)) { report.preExistingErrors++; counts.set(key, counts.get(key) - 1); }
    else report.introducedErrors.push({ path, line: m.line, rule: m.ruleId, message: m.message });
  }
  for (const [message, count] of counts) if (count) report.resolvedErrors.push({ path, count, message });
  if (errors.length || baseline.length) report.files.push({ path, currentErrors: errors.length, baselineErrors: baseline.length });
}
writeFileSync('inventory-lint-comparison.tmp.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ baselineSha: report.baselineSha, currentErrors: report.currentErrors, preExistingErrors: report.preExistingErrors, introducedErrors: report.introducedErrors, resolvedErrorCount: report.resolvedErrors.reduce((sum, row) => sum + row.count, 0) }, null, 2));
if (report.introducedErrors.length) process.exitCode = 1;
