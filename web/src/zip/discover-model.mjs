const DEFAULT_CLIP_LENGTH = 15;

export function sourcesFor(stories) {
  return (Array.isArray(stories) ? stories : []).flatMap(story => {
    if (typeof story?.title !== 'string' || !story.title.trim()) return [];
    try {
      const url = new URL(story.url);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return [];
      return [{
        title: story.title, url: url.href, date: story.publishedAt ?? '',
        publisher: url.hostname.replace(/^www\./, ''), description: story.description ?? '',
      }];
    } catch {
      return [];
    }
  });
}

function originalVideoUrl(account, id) {
  if (account.platform === 'YouTube' && /^[\w-]{11}$/.test(id)) return `https://www.youtube.com/watch?v=${id}`;
  if (account.platform === 'Instagram' && /^[\w-]+$/.test(id)) return `https://www.instagram.com/reel/${id}/`;
  if (account.platform === 'TikTok' && /^\d+$/.test(id) && /^@[\w.]+$/.test(account.handle)) {
    return `https://www.tiktok.com/${account.handle}/video/${id}`;
  }
}

export function clipsFor({ account, matches, videos = [], topic }) {
  const metadata = new Map(videos.map(video => [video.id, video]));
  const clips = new Map();
  for (const match of Array.isArray(matches) ? matches : []) {
    if (typeof match?.id !== 'string' || !Number.isFinite(match.start) || match.start < 0 ||
        typeof match.text !== 'string' || !match.text.trim()) continue;
    const source = metadata.get(match.id);
    const rawDuration = source?.durationSec ?? source?.duration;
    const durationSec = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : undefined;
    const end = Math.min(match.start + DEFAULT_CLIP_LENGTH, durationSec ?? Infinity);
    if (end <= match.start) continue;
    const id = JSON.stringify([account.url, match.id, match.start]);
    clips.set(id, {
      id, start: match.start, end, excerpt: match.text,
      why: `The transcript contains “${topic.name}”.`,
      topic,
      video: {
        id: match.id, title: source?.title || match.title || 'Untitled video',
        url: source?.url || originalVideoUrl(account, match.id),
        publishedAt: typeof source?.publishedAt === 'string' ? source.publishedAt : '',
        thumbnail: source?.thumbnail, durationSec,
      },
      profile: { url: account.url, platform: account.platform },
    });
  }
  return [...clips.values()];
}

export async function searchDiscover({ query, accounts, entries, findStories, findMatches }) {
  const topic = { name: query, sources: [] };
  const [news, ...archives] = await Promise.allSettled([
    Promise.resolve().then(() => findStories(query)),
    ...accounts.map(account => Promise.resolve().then(() => findMatches(account.url, query))),
  ]);
  if (news.status === 'fulfilled') topic.sources = sourcesFor(news.value?.stories);
  const failedArchives = [];
  const clips = archives.flatMap((reply, index) => {
    const account = accounts[index];
    if (reply.status !== 'fulfilled') {
      failedArchives.push(account);
      return [];
    }
    return clipsFor({
      account, matches: reply.value?.matches, videos: entries?.[account.url]?.snapshot?.videos ?? [], topic,
    });
  });
  return { topic, clips, failedArchives, newsError: news.status === 'rejected' };
}
