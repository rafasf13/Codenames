const TMDB_API_KEY = '53710cdd3f74dfaf2157b3c2d8533090';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w185';

let genreCache = null;
let languageCache = null;

async function fetchGenres() {
  if (genreCache) return genreCache;
  const res = await fetch(`${TMDB_BASE}/genre/movie/list?api_key=${TMDB_API_KEY}&language=en-US`);
  const data = await res.json();
  genreCache = data.genres;
  return genreCache;
}

async function fetchLanguages() {
  if (languageCache) return languageCache;
  const res = await fetch(`${TMDB_BASE}/configuration/languages?api_key=${TMDB_API_KEY}`);
  const data = await res.json();
  // Return common languages sorted by english_name
  const common = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'hi', 'ru', 'ar', 'th', 'sv', 'da', 'no', 'fi', 'pl', 'tr', 'nl'];
  languageCache = data
    .filter(l => common.includes(l.iso_639_1))
    .sort((a, b) => a.english_name.localeCompare(b.english_name));
  return languageCache;
}

async function discoverMovies(genreIds, decades, languages) {
  const allMovies = [];
  const seenIds = new Set();
  const genreParam = genreIds.length ? `&with_genres=${genreIds.join(',')}` : '';
  const langParam = languages.length ? `&with_original_language=${languages.join('|')}` : '';

  const dateRanges = decades.length > 0
    ? decades.map(d => ({ gte: `${d}-01-01`, lte: `${d + 9}-12-31` }))
    : [null];

  for (const range of dateRanges) {
    let dateParam = '';
    if (range) {
      dateParam = `&primary_release_date.gte=${range.gte}&primary_release_date.lte=${range.lte}`;
    }

    // First, find out how many pages are available
    const probeUrl = `${TMDB_BASE}/discover/movie?api_key=${TMDB_API_KEY}&language=en-US&sort_by=popularity.desc&vote_count.gte=50${genreParam}${dateParam}${langParam}&page=1`;
    const probeRes = await fetch(probeUrl);
    const probeData = await probeRes.json();
    const totalPages = Math.min(probeData.total_pages || 1, 500);

    // Add results from page 1
    if (probeData.results) {
      probeData.results.forEach(m => {
        if (!seenIds.has(m.id)) { seenIds.add(m.id); allMovies.push(m); }
      });
    }

    // Pick random pages from the available range to get variety
    const pagesPerRange = Math.ceil(8 / dateRanges.length) || 2;
    const randomPages = [];
    for (let i = 0; i < pagesPerRange && totalPages > 1; i++) {
      const p = Math.floor(Math.random() * Math.min(totalPages, 50)) + 1;
      if (p !== 1 && !randomPages.includes(p)) randomPages.push(p);
    }

    for (const page of randomPages) {
      const url = `${TMDB_BASE}/discover/movie?api_key=${TMDB_API_KEY}&language=en-US&sort_by=popularity.desc&vote_count.gte=50${genreParam}${dateParam}${langParam}&page=${page}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.results) {
        data.results.forEach(m => {
          if (!seenIds.has(m.id)) { seenIds.add(m.id); allMovies.push(m); }
        });
      }
    }
  }

  // Deduplicate similar titles (e.g., "Super Mario Bros. Movie" and "Super Mario Galaxy")
  const deduped = deduplicateSimilarTitles(allMovies);

  const shuffled = deduped.sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, 25);
  return picked.map(m => ({
    id: m.id,
    title: m.title,
    posterPath: m.poster_path,
    releaseDate: m.release_date,
    overview: m.overview
  }));
}

function deduplicateSimilarTitles(movies) {
  // Remove movies with very similar titles (keep only one per group)
  const result = [];
  const usedKeys = new Set();
  for (const m of movies) {
    // Normalize: lowercase, remove punctuation, articles, numbers
    const key = m.title.toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .replace(/\b(the|a|an)\b/g, '')
      .trim()
      .replace(/\s+/g, ' ');
    // Use first 3 significant words as a fuzzy key
    const words = key.split(' ').filter(w => w.length > 2);
    const shortKey = words.slice(0, 3).join(' ');
    if (shortKey && usedKeys.has(shortKey)) continue;
    if (shortKey) usedKeys.add(shortKey);
    result.push(m);
  }
  return result;
}

let searchAbort = null;

// Search for actors AND directors
async function searchPerson(query) {
  if (searchAbort) searchAbort.abort();
  searchAbort = new AbortController();

  if (!query || query.length < 2) return [];
  const url = `${TMDB_BASE}/search/person?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}&language=en-US`;
  try {
    const res = await fetch(url, { signal: searchAbort.signal });
    const data = await res.json();
    return (data.results || [])
      .filter(p => p.known_for_department === 'Acting' || p.known_for_department === 'Directing')
      .slice(0, 8)
      .map(p => ({
        id: p.id,
        name: p.name,
        profilePath: p.profile_path,
        department: p.known_for_department
      }));
  } catch (e) {
    if (e.name === 'AbortError') return [];
    throw e;
  }
}

// Get all movie IDs a person is connected to (as actor OR director)
async function getPersonMovieCredits(personId) {
  const url = `${TMDB_BASE}/person/${personId}/movie_credits?api_key=${TMDB_API_KEY}&language=en-US`;
  const res = await fetch(url);
  const data = await res.json();
  const castIds = (data.cast || []).map(c => c.id);
  const crewIds = (data.crew || [])
    .filter(c => c.job === 'Director')
    .map(c => c.id);
  // Merge unique
  return [...new Set([...castIds, ...crewIds])];
}

async function validateActors(actors, boardMovieIds) {
  const results = [];
  for (const actor of actors) {
    if (!actor || !actor.id) {
      results.push({ actor: null, coveredMovies: [] });
      continue;
    }
    const movieIds = await getPersonMovieCredits(actor.id);
    const covered = boardMovieIds.filter(mid => movieIds.includes(mid));
    results.push({
      actor: { id: actor.id, name: actor.name },
      coveredMovies: covered
    });
    await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

// Fetch top 5 billed cast + director for a movie
async function getMovieTopCast(movieId) {
  const url = `${TMDB_BASE}/movie/${movieId}/credits?api_key=${TMDB_API_KEY}&language=en-US`;
  const res = await fetch(url);
  const data = await res.json();
  const cast = (data.cast || [])
    .sort((a, b) => a.order - b.order)
    .slice(0, 5)
    .map(c => ({ id: c.id, name: c.name, role: 'actor' }));
  const directors = (data.crew || [])
    .filter(c => c.job === 'Director')
    .map(c => ({ id: c.id, name: c.name, role: 'director' }));
  return [...directors, ...cast];
}

async function fetchAllMovieCasts(boardMovieIds) {
  const casts = {};
  for (const mid of boardMovieIds) {
    casts[mid] = await getMovieTopCast(mid);
    await new Promise(r => setTimeout(r, 200));
  }
  return casts;
}
