import { useState } from 'react';

const API = process.env.REACT_APP_API_URL || 'http://localhost:3000/api';

export default function BatchUpload({ onComplete }) {
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const submit = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setStatus('');
    setError('');
    try {
      const input = JSON.parse(await file.text());
      if (!Array.isArray(input) || input.length === 0) throw new Error('Upload a JSON array of role objects.');
      if (input.some((item) => typeof item.jd !== 'string' || typeof item.company_url !== 'string')) throw new Error('Each role needs jd and company_url fields.');
      let response;
      try {
        response = await fetch(`${API}/kits/batch`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roles: input }) });
      } catch {
        throw new Error(`The API is unavailable at ${API}. Start the backend and try again.`);
      }
      const raw = await response.text();
      let body;
      try { body = raw ? JSON.parse(raw) : null; } catch { throw new Error(`Server returned an unexpected response (${response.status}).`); }
      if (!response.ok) throw new Error(body?.error?.message || 'Batch upload failed.');
      const failed = body.kits.filter((kit) => kit.status === 'failed').length;
      setStatus(`${body.kits.length} preparations queued${failed ? `, ${failed} failed validation` : ''}.`);
      onComplete();
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      event.target.value = '';
    }
  };

  return <div className="batch-upload"><span className="eyebrow">MULTI-ROLE PREPARATION</span><h3>Upload several roles at once</h3><p>Use a JSON array with <code>jd</code>, <code>company_url</code>, and optional <code>days</code> fields.</p><label className="file-button">Choose JSON file<input type="file" accept="application/json,.json" onChange={submit} /></label>{status && <p className="success">{status}</p>}{error && <p className="error">{error}</p>}</div>;
}
