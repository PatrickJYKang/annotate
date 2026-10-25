const repository = 'https://github.com/PatrickJYKang/annotate';

export function sourceUrl(commit) {
  return /^[a-f0-9]{40}$/i.test(commit ?? '') ? `${repository}/tree/${commit}` : repository;
}

export function isSourceLink(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://github.com' && !url.username && !url.password && !url.search && !url.hash
      && /^\/PatrickJYKang\/annotate(?:\/tree\/[a-f0-9]{40})?\/?$/i.test(url.pathname);
  } catch { return false; }
}
