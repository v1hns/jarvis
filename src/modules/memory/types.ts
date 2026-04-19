export interface EpisodeRecord {
  id: string;
  timestampMs: number;
  dayKey: string;
  sceneSummary: string;
  placeLabel: string;
  objects: string[];
  ocrText: string[];
  activityHint: string;
  salience: number;
}

export interface PlaceNode {
  label: string;
  episodeIds: string[];
  firstSeenMs: number;
  lastSeenMs: number;
}

export interface DaySegment {
  startMs: number;
  endMs: number;
  placeLabel: string;
  activity: string;
}

export interface ObjectSighting {
  object: string;
  lastSeenMs: number;
  placeLabel: string;
  episodeId: string;
}

export interface DailyMemoryPalace {
  dayKey: string;
  places: PlaceNode[];
  segments: DaySegment[];
  objectLastSeen: ObjectSighting[];
  daySummary: string;
  episodeCount: number;
}

export interface MemoryQueryResult {
  answer: string;
  supportingEpisodeIds: string[];
  dayKey: string;
  confidence: 'high' | 'low' | 'none';
}
