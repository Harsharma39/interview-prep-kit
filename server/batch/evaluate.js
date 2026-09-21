const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { generateKit } = require('../services/generation');
const { validateKit } = require('../schemas/kitSchema');

const getArg = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};

const validateCase = (item) => {
  if (!item || typeof item !== 'object' || !Object.prototype.hasOwnProperty.call(item, 'id')) return 'Each case requires an id.';
  if (typeof item.jd !== 'string' || !item.jd.trim()) return 'Each case requires a non-empty jd string.';
  if (typeof item.company_url !== 'string') return 'Each case requires a company_url string.';
  try {
    const url = new URL(item.company_url);
    if (!['http:', 'https:'].includes(url.protocol)) return 'company_url must use HTTP or HTTPS.';
  } catch { return 'company_url must be a valid URL.'; }
  if (!Number.isInteger(item.days) || item.days < 1 || item.days > 30) return 'days must be an integer from 1 to 30.';
  return null;
};

// The evaluator is a trusted local CLI. Appendix B explicitly permits
// localhost fixtures, while the public API keeps private-network research off.
const isLocalEvaluatorUrl = (value) => {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '::1' || (net.isIP(hostname) === 4 && hostname.startsWith('127.'));
  } catch {
    return false;
  }
};

const errorFor = (error) => {
  if (error?.code === 'COMPANY_UNREACHABLE') return { code: 'COMPANY_UNREACHABLE', message: error.message };
  if (error?.code === 'COMPANY_FETCH_FAILED' || error?.code === 'RESEARCH_FAILED') return { code: 'RESEARCH_FAILED', message: error.message };
  if (error?.code === 'VALIDATION_FAILED' || /failed validation/i.test(error?.message || '')) return { code: 'VALIDATION_FAILED', message: error.message };
  return { code: 'GENERATION_FAILED', message: error?.message || 'Kit generation failed.' };
};

const evaluateCases = async (cases, { generate = generateKit, concurrency = 2 } = {}) => {
  const results = Array(cases.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < cases.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = cases[index];
      const invalid = validateCase(item);
      if (invalid) {
        results[index] = { id: item?.id, status: 'failed', kit: null, error: { code: 'INVALID_CASE', message: invalid } };
        continue;
      }
      try {
        const kit = await generate({ jd: item.jd, company_url: item.company_url, days: item.days, allowPrivateResearch: isLocalEvaluatorUrl(item.company_url) });
        const errors = validateKit(kit);
        results[index] = errors.length
          ? { id: item.id, status: 'failed', kit: null, error: { code: 'VALIDATION_FAILED', message: errors.join(' ') } }
          : { id: item.id, status: 'ok', kit, error: null };
      } catch (error) {
        results[index] = { id: item.id, status: 'failed', kit: null, error: errorFor(error) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(3, concurrency, cases.length || 1)) }, worker));
  return results;
};

const writeOutput = async (outputPath, output) => {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(output, null, 2), 'utf8');
  await fs.rename(temporaryPath, outputPath);
};

const run = async ({ inputPath = getArg('--input'), outputPath = getArg('--output') } = {}) => {
  if (!inputPath || !outputPath) throw new Error('Usage: npm run evaluate -- --input <cases.json> --output <kits.json>');
  if (path.resolve(inputPath) === path.resolve(outputPath)) throw new Error('Output path must not overwrite the input file.');
  let cases;
  try { cases = JSON.parse(await fs.readFile(inputPath, 'utf8')); } catch (error) { throw new Error(`Could not read valid JSON input: ${error.message}`); }
  if (!Array.isArray(cases)) throw new Error('Input JSON root must be an array of cases.');
  const kits = await evaluateCases(cases);
  const output = { version: '1.0', generated_at: new Date().toISOString(), kits };
  await writeOutput(outputPath, output);
  return output;
};

if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { run, evaluateCases, validateCase, errorFor, writeOutput, isLocalEvaluatorUrl };
