// Resumo do lint por regra e por arquivo. Uso: npx eslint . -f json | node scripts/dev/lint-summary.mjs
let raw = '';
process.stdin
  .on('data', (c) => (raw += c))
  .on('end', () => {
    const files = JSON.parse(raw);
    const byRule = {};
    const byFile = {};
    for (const f of files) {
      for (const m of f.messages) {
        const rule = m.ruleId ?? '(parse error)';
        byRule[rule] = (byRule[rule] ?? 0) + 1;
        const rel = f.filePath.replace(process.cwd(), '').replace(/^[\\/]/, '');
        byFile[rel] = (byFile[rel] ?? 0) + 1;
      }
    }
    console.log('POR REGRA:');
    Object.entries(byRule)
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, v]) => console.log('  ' + String(v).padStart(4) + '  ' + k));
    console.log('\nPOR ARQUIVO (top 10):');
    Object.entries(byFile)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([k, v]) => console.log('  ' + String(v).padStart(4) + '  ' + k));
  });
