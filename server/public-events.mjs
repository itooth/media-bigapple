import { findEvent } from '../src/lib/eventSlug.js';

const pick = (value, keys) => Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));

// The archive needs card/search fields, not the scene album, videos or source metadata.
// Keep case descriptions and readmes because the existing search includes both.
export function catalogEvent(event) {
  return {
    ...pick(event, ['id', 'uid', 'slug', 'partner', 'description', 'sourceDate', 'image', 'alt', 'tags']),
    detail: {
      ...pick(event.detail || {}, ['title', 'city']),
      productionGallery: (event.detail?.productionGallery || []).map((item) => pick(item,
        ['id', 'path', 'title', 'alt', 'image', 'href', 'description', 'readme', 'position'])),
    },
  };
}

// Apply selection only AFTER the caller has restricted events to the brand's scope.
// No query preserves the complete legacy API contract used by existing tools/gateways.
export function publicEvents(events, params) {
  if (params.has('event')) {
    const event = findEvent(events, params.get('event'));
    return event ? [event] : [];
  }
  if (params.get('view') === 'catalog') return events.map(catalogEvent);
  return events;
}
