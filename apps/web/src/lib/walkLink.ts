import {
  buildWalkInvite,
  encodeWalkPlan,
  makeRoute,
  type AgendaSegment,
  type LoopResult,
  type Meeting,
  type WalkPlan,
} from '@cbaw/core';
import { segmentWhen } from '../components/AgendaTimeline';
import type { Office } from './office';
import { paths } from './router';

/** Where phones open the walk: the deployed static page if configured, else this app. */
export function walkBaseUrl(): string {
  const configured = (import.meta.env.VITE_PUBLIC_WALK_URL as string | undefined)?.trim();
  if (configured) return configured.replace(/#.*$/, '');
  return `${window.location.origin}${window.location.pathname}`;
}

/** A phone on the same Wi-Fi can't open localhost, and GPS needs HTTPS anyway. */
export function isLocalOnly(url: string): boolean {
  return /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:|\/|$)/.test(url);
}

export function toWalkPlan(
  meeting: Meeting,
  loop: LoopResult,
  segments: AgendaSegment[],
  office: Office,
  /** Be back earlier than the meeting end (shorter loop because of rain). */
  endOverride?: number,
): WalkPlan {
  // Agenda distances are in the router's metres; the walk page measures along the polyline.
  const scale = makeRoute(loop.points).length / loop.distanceM;
  return {
    title: meeting.title,
    start: meeting.start,
    end: endOverride ?? meeting.end,
    speedKmh: loop.speedKmh,
    route: loop.points,
    startLabel: office.label,
    segments: segments.map((s) => ({
      topic: s.topic,
      prompt: s.prompt,
      startAlong: s.startAlong * scale,
      endAlong: s.endAlong * scale,
      untilLabel: s.untilLabel,
    })),
  };
}

export async function buildWalkUrl(plan: WalkPlan): Promise<string> {
  return `${walkBaseUrl()}#${paths.walk(await encodeWalkPlan(plan))}`;
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'meeting';

/** Build the walking invite and hand it to the browser as a download. */
export function downloadInvite(
  meeting: Meeting,
  loop: LoopResult,
  segments: AgendaSegment[],
  office: Office,
  routeUrl: string,
) {
  const ics = buildWalkInvite({
    title: meeting.title,
    start: meeting.start,
    end: meeting.end,
    startPoint: office,
    startLabel: office.label,
    routeUrl,
    distanceM: loop.distanceM,
    loopMin: Math.round(loop.durationMin),
    agenda: segments.map((s, i) => ({
      when: segmentWhen(s, i === segments.length - 1),
      topic: s.prompt ? `${s.topic} (${s.prompt})` : s.topic,
    })),
  });
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `walk-${slug(meeting.title)}.ics`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
