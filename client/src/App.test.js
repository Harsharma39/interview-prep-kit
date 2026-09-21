import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App, { CompanyBriefEditor, FlashcardManager } from './App';

const record = {
  _id: 'kit-1',
  kit: {
    source: { company: 'Acme' },
    role: { requirements: [{ id: 'r1', text: 'React' }] },
    company_brief: { summary: 'Original summary', what_they_do: 'Original work', sources: [] },
    flashcards: [{ id: 'f1', front: 'Original front', back: 'Original back', requirement_ids: ['r1'] }],
  },
};

const jsonResponse = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

test('renders the workspace loading state', () => {
  global.fetch = jest.fn(() => new Promise(() => {}));
  render(<App />);
  expect(screen.getByText(/loading workspace/i)).toBeInTheDocument();
});

test('saves a company brief using the existing kit endpoint response', async () => {
  const onChanged = jest.fn();
  global.fetch = jest.fn().mockResolvedValue(jsonResponse({ company_brief: { ...record.kit.company_brief, summary: 'Saved summary' } }));
  render(<CompanyBriefEditor record={record} onChanged={onChanged} />);
  fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'Saved summary' } });
  fireEvent.click(screen.getByRole('button', { name: /save company brief/i }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/kits/kit-1/company-brief'), expect.objectContaining({ method: 'PATCH' }));
  expect(onChanged.mock.calls[0][0].kit.company_brief.summary).toBe('Saved summary');
});

test('edits a flashcard and retains its requirement ids from the server response', async () => {
  const onChanged = jest.fn();
  global.fetch = jest.fn().mockResolvedValue(jsonResponse({ flashcard: { ...record.kit.flashcards[0], front: 'Saved front' } }));
  render(<FlashcardManager record={record} onChanged={onChanged} />);
  fireEvent.click(screen.getByRole('button', { name: /edit flashcard/i }));
  fireEvent.change(screen.getByLabelText('Flashcard f1 front'), { target: { value: 'Saved front' } });
  fireEvent.click(screen.getByRole('button', { name: /save flashcard/i }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/kits/kit-1/flashcards/f1'), expect.objectContaining({ method: 'PATCH' }));
  expect(onChanged.mock.calls[0][0].kit.flashcards[0].requirement_ids).toEqual(['r1']);
});
