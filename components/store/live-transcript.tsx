"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, MessageSquare } from "lucide-react";
import "./live-transcript.css";

type Speaker = "user" | "assistant";
type TranscriptEntry = { id: number; role: Speaker; text: string; recentStart: number };
type Transcript = {
  entries: TranscriptEntry[];
  latestId: number | null;
  nextId: number;
  streams: Partial<Record<Speaker, { id: number; text: string; turnId?: string }>>;
};

function appendedText(previous: string, incoming: string): string | null {
  if (incoming.startsWith(previous)) return incoming.slice(previous.length);
  // Live retains a rolling 2,000-character buffer. Preserve earlier words in
  // the local conversation when that buffer advances during a long turn.
  if (previous.length === 2000 && incoming.length === 2000) {
    let offset = previous.indexOf(incoming.slice(0, 32), 1);
    while (offset !== -1) {
      const overlap = previous.length - offset;
      if (previous.slice(offset) === incoming.slice(0, overlap)) return incoming.slice(overlap);
      offset = previous.indexOf(incoming.slice(0, 32), offset + 1);
    }
  }
  return null;
}

function wordStart(text: string, position: number) {
  while (position > 0 && !/\s/.test(text[position - 1])) position -= 1;
  return position;
}

export function useLiveTranscript() {
  const [transcript, setTranscript] = useState<Transcript>({ entries: [], latestId: null, nextId: 0, streams: {} });

  const receive = useCallback((text: string, role: Speaker, metadata?: { turnId: string }) => {
    if (!text.trim()) return;
    setTranscript(previous => {
      const stream = previous.streams[role];
      const continuesTurn = stream && (!metadata || metadata.turnId === stream.turnId);
      const delta = continuesTurn ? appendedText(stream.text, text) : null;
      if (stream && delta === "") return previous;
      if (stream && delta !== null && previous.latestId === stream.id) {
        return {
          ...previous,
          latestId: stream.id,
          streams: { ...previous.streams, [role]: { id: stream.id, text, turnId: metadata?.turnId } },
          entries: previous.entries.map(entry => entry.id === stream.id
            ? { ...entry, text: entry.text + delta, recentStart: /^\s/.test(delta) ? entry.text.length : wordStart(entry.text, entry.text.length) }
            : entry),
        };
      }
      const id = previous.nextId;
      return {
        entries: [...previous.entries, { id, role, text: delta ?? text, recentStart: 0 }],
        latestId: id,
        nextId: id + 1,
        streams: { ...previous.streams, [role]: { id, text, turnId: metadata?.turnId } },
      };
    });
  }, []);

  const append = useCallback((text: string, role: Speaker) => {
    if (!text.trim()) return;
    setTranscript(previous => ({
      entries: [...previous.entries, { id: previous.nextId, role, text, recentStart: 0 }],
      latestId: previous.nextId,
      nextId: previous.nextId + 1,
      streams: previous.streams,
    }));
  }, []);

  return { entries: transcript.entries, latestId: transcript.latestId, receive, append };
}

export function LiveTranscript({ entries, latestId }: Pick<ReturnType<typeof useLiveTranscript>, "entries" | "latestId">) {
  const viewport = useRef<HTMLDivElement>(null);
  const followsLatest = useRef(true);
  const [reviewing, setReviewing] = useState(false);

  useLayoutEffect(() => {
    if (followsLatest.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [entries]);

  function showLatest() {
    followsLatest.current = true;
    setReviewing(false);
    if (viewport.current) {
      viewport.current.scrollTop = viewport.current.scrollHeight;
      viewport.current.focus({ preventScroll: true });
    }
  }

  return <section className="live-transcript" aria-label="Conversation transcript">
    <div className="live-transcript-heading">
      <span><MessageSquare size={13} aria-hidden="true" />Conversation</span>
      {reviewing && <button type="button" onClick={showLatest}><ArrowDown size={12} aria-hidden="true" />Latest</button>}
    </div>
    {entries.length ? <div className="live-transcript-viewport" ref={viewport} tabIndex={0} role="region" aria-label="Conversation history" onScroll={event => {
      const element = event.currentTarget;
      followsLatest.current = element.scrollHeight - element.clientHeight - element.scrollTop < 24;
      setReviewing(!followsLatest.current);
    }}>
      <ol className="live-transcript-entries">
        {entries.map(entry => <li key={entry.id} className={entry.id === latestId ? "is-latest" : undefined}>
          <span className="live-transcript-speaker">{entry.role === "user" ? "You" : "Stylist"}</span>
          <p>{entry.id === latestId
            ? <>{entry.text.slice(0, entry.recentStart)}<strong>{entry.text.slice(entry.recentStart)}</strong></>
            : entry.text}</p>
        </li>)}
      </ol>
    </div> : <p className="live-transcript-empty">Your words and the stylist’s replies appear here.</p>}
  </section>;
}
