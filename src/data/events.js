import { mediaByActivity } from './mediaIndex.generated.js';
import { libraryEvents } from './libraryEvents.generated.js';
import aichongCaseMedia from 'virtual:aichong-cases';
import caseMedia from 'virtual:case-media';
import activityManifests from 'virtual:activity-manifests';
import socialLinks from 'virtual:social-links';
import agentProductionCatalog from './agentProductionCatalog.js';
import { renderEvent, sortEvents } from '../lib/renderEvent.js';

function dateParts(value) {
  const match = String(value || '').match(/^(\d{4})[-年](\d{1,2})(?:[-月](\d{1,2}))?/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: match[3] ? Number(match[3]) : null };
}

function monthKey(value) {
  const parts = dateParts(value);
  return parts ? `${parts.year}-${String(parts.month).padStart(2, '0')}` : String(value || '');
}

function monthLabel(value) {
  const parts = dateParts(value);
  return parts ? `${parts.year}年${parts.month}月` : value;
}

const legacyById = new Map(libraryEvents.map((record) => [record.id, record]));
const records = activityManifests
  .filter((record) => record.id !== '04-2')
  .map((record) => ({ ...legacyById.get(record.id), ...record }));

// Each activity's raw inputs; the server stores these and renders on read (src/lib/renderEvent.js).
export const activitySources = records.map((record) => ({
  uid: record.folder || record.id,
  record,
  assets: mediaByActivity(record.id),
  cases: caseMedia[record.id] || caseMedia[record.folder] || [],
  social: socialLinks[record.id] || socialLinks[record.folder] || [],
  ...(record.id === '01-1' && aichongCaseMedia.length ? { aichongCases: aichongCaseMedia } : {}),
  ...(record.id === '08-22-ai-agent-17' ? { agentCatalog: agentProductionCatalog } : {}),
}));

export const allEvents = sortEvents(activitySources.map(renderEvent));
export const eventMonths = Object.entries(allEvents.reduce((groups, event) => {
  const key = monthKey(event.sourceDate);
  (groups[key] ||= []).push(event);
  return groups;
}, {}))
  .sort(([a], [b]) => b.localeCompare(a))
  .map(([key, events]) => ({ label: monthLabel(key), events: events.sort((a, b) => String(b.sourceDate).localeCompare(String(a.sourceDate))) }));

export function getEventById(id) { return allEvents.find((event) => event.id === id); }
