import { useEffect, useRef, useState } from 'react';
import { ArrowSquareOutIcon, CircleNotchIcon } from '@phosphor-icons/react';
import './onboarding.css';

const steps = ['Your profile', 'Review accounts', 'Dashboard'];
const accountKey = url => url.startsWith('https://www.youtube.com/channel/') ? url : url.toLowerCase();
const profileError = 'Enter a public YouTube, Instagram, or TikTok profile link, not a video or post.';

function sourceLink(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function initialRows(anchor, initial, normalizeAccount) {
  const approved = initial?.accounts ?? [];
  const oldAnchor = normalizeAccount(initial?.anchor ?? '');
  const key = accountKey(anchor.url);
  const selected = !approved.length || !oldAnchor || key !== accountKey(oldAnchor.url) ||
    approved.some(account => accountKey(account.url) === key);
  const rows = new Map([[key, { ...anchor, evidence: 'The link you entered', selected }]]);
  for (const { url } of approved) {
    const account = normalizeAccount(url);
    if (!account || rows.has(accountKey(account.url))) continue;
    rows.set(accountKey(account.url), { ...account, evidence: 'Previously selected', selected: true });
  }
  return [...rows.values()];
}

export function CreatorOnboarding({ initial, lookup, normalizeAccount, onConfirm, onCancel }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState(initial?.name ?? '');
  const [profile, setProfile] = useState(initial?.anchor ?? '');
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState('');
  const run = useRef(0);
  const heading = useRef(null);

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  async function findAccounts(event) {
    event.preventDefault();
    const anchor = normalizeAccount(profile);
    if (!anchor) {
      setError(profileError);
      return;
    }
    const creatorName = name.trim();
    if (creatorName.length < 2) return;
    const previous = review?.anchor.url === anchor.url && review.name === creatorName ? review.rows : null;
    const sameCreator = initial?.name?.trim().toLowerCase() === creatorName.toLowerCase() ||
      normalizeAccount(initial?.anchor)?.url === anchor.url;
    const rows = previous ?? initialRows(anchor, sameCreator ? initial : null, normalizeAccount);
    const id = ++run.current;
    setError('');
    setManualError('');
    setReview({ name: creatorName, anchor, rows, loading: true, message: '' });
    setStep(2);
    try {
      const result = await lookup({ name: creatorName, profileUrl: anchor.url });
      if (id !== run.current) return;
      setReview(current => {
        const next = new Map(current.rows.map(account => [accountKey(account.url), account]));
        for (const candidate of result.accounts ?? []) {
          const account = normalizeAccount(candidate.url);
          if (!account || next.has(accountKey(account.url))) continue;
          next.set(accountKey(account.url), {
            ...account,
            evidence: candidate.origin === 'found' ? 'Previously checked public profile' : (candidate.evidence || 'Suggested by You.com'),
            source: sourceLink(candidate.sourceUrl),
            selected: false,
          });
        }
        const items = [...next.values()];
        const message = result.message || (items.length === 1 ? 'You.com found no other profiles. You can add a link below.' : '');
        return { ...current, rows: items, loading: false, message };
      });
    } catch {
      if (id !== run.current) return;
      setReview(current => ({
        ...current, loading: false, message: 'You.com search is unavailable. You can still import your known accounts.',
      }));
    }
  }

  function updateSelection(url, selected) {
    setReview(current => ({
      ...current, rows: current.rows.map(row => row.url === url ? { ...row, selected } : row),
    }));
  }

  function addAccount(event) {
    event.preventDefault();
    const account = normalizeAccount(manual);
    if (!account) { setManualError(profileError); return; }
    setReview(current => {
      const existing = current.rows.findIndex(row => accountKey(row.url) === accountKey(account.url));
      const rows = [...current.rows];
      if (existing < 0) rows.push({ ...account, evidence: 'Added by you', selected: true });
      else rows[existing] = { ...rows[existing], selected: true };
      return { ...current, rows };
    });
    setManual('');
    setManualError('');
  }

  function confirmAccounts() {
    const accounts = review.rows.filter(row => row.selected)
      .map(({ platform, handle, url }) => ({ platform, handle, url }));
    if (!accounts.length) return;
    onConfirm({ name: review.name, anchor: review.anchor.url, accounts });
  }

  return <section className="creator-onboarding" aria-label="Creator setup">
    <ol className="onboarding-steps" aria-label="Setup progress">
      {steps.map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined}>
        <span>0{index + 1}</span>{label}
      </li>)}
    </ol>
    <header className="page-heading">
      <h1 ref={heading} tabIndex={-1}>{step === 1 ? 'Set up your creator archive' : 'Review your accounts'}</h1>
      <p className="page-intro">{step === 1
        ? 'Enter your name and one public profile. You.com will look for your other accounts.'
        : 'Select the profiles that belong to you. Only the accounts you select will be imported.'}</p>
    </header>

    {step === 1 ? <form className="onboarding-form" onSubmit={findAccounts}>
      <label>Creator name
        <input value={name} required minLength={2} maxLength={100} autoComplete="name"
          onChange={event => setName(event.target.value)} />
      </label>
      <label>Public profile URL
        <input value={profile} required maxLength={500} inputMode="url" autoCapitalize="none" spellCheck={false}
          placeholder="https://www.youtube.com/@yourhandle" aria-describedby={error ? 'profile-error profile-help' : 'profile-help'}
          aria-invalid={error ? true : undefined} onChange={event => { setProfile(event.target.value); setError(''); }} />
        <small id="profile-help">YouTube, Instagram, or TikTok</small>
      </label>
      {error && <p className="workspace-message" id="profile-error" role="alert">{error}</p>}
      <div className="onboarding-actions">
        {onCancel && <button className="onboarding-secondary" type="button" onClick={onCancel}>Back to dashboard</button>}
        <button className="primary" disabled={name.trim().length < 2 || !profile.trim()}>Find my accounts</button>
      </div>
    </form> : <>
      {review.loading && <p className="onboarding-status" role="status"><CircleNotchIcon className="spin" aria-hidden="true" /> You.com is looking for your profiles…</p>}
      {review.message && <p className="onboarding-status" role="status">{review.message}</p>}
      <ul className="onboarding-accounts" aria-label="Accounts to import">
        {review.rows.map(account => <li key={account.url}>
          <div className="onboarding-account">
            <label>
              <input type="checkbox" checked={account.selected} onChange={event => updateSelection(account.url, event.target.checked)} />
              <span>{account.platform} · {account.handle}</span>
            </label>
            <p>{account.evidence}{account.source && account.source !== account.url &&
              <> · <a href={account.source} target="_blank" rel="noreferrer">Source</a></>}</p>
          </div>
          <a className="workspace-link onboarding-profile-link" href={account.url} target="_blank" rel="noreferrer"
            aria-label={`View ${account.platform} profile ${account.handle}`}>
            View profile <ArrowSquareOutIcon aria-hidden="true" />
          </a>
        </li>)}
      </ul>
      <form className="onboarding-form onboarding-add" onSubmit={addAccount}>
        <label>Add another profile
          <input type="text" value={manual} maxLength={500} inputMode="url" autoCapitalize="none" spellCheck={false}
            placeholder="Paste a public profile URL" aria-invalid={manualError ? true : undefined}
            aria-describedby={manualError ? 'manual-error' : undefined}
            onChange={event => { setManual(event.target.value); setManualError(''); }} />
        </label>
        <button type="submit" className="onboarding-secondary" disabled={!manual.trim()}>Add profile</button>
      </form>
      {manualError && <p className="workspace-message" id="manual-error" role="alert">{manualError}</p>}
      <div className="onboarding-actions">
        <button className="onboarding-secondary" type="button" onClick={() => { run.current += 1; setStep(1); }}>Back</button>
        <button className="primary" type="button" disabled={review.loading || !review.rows.some(row => row.selected)}
          onClick={confirmAccounts}>Import selected accounts</button>
      </div>
    </>}
  </section>;
}
