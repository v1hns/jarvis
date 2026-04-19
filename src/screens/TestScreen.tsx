import React, { useState, useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { JarvisState } from '../hooks/useJarvis';
import type { TestCase } from '../modules/TestHarness';
import type { ReplayResult } from '../modules/TestHarness';

interface Props {
  onBack: () => void;
  jarvis: JarvisState;
}

export function TestScreen({ onBack, jarvis }: Props) {
  const {
    modelsReady, isThinking,
    isRecording, armRecording, disarmRecording,
    testCases, replayCase, removeTestCase,
  } = jarvis;

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replaying, setReplaying]   = useState<string | null>(null);
  const [result, setResult]         = useState<ReplayResult | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);

  const handleArm = useCallback(() => {
    if (isRecording) disarmRecording();
    else armRecording();
  }, [isRecording, armRecording, disarmRecording]);

  const handleReplay = useCallback(async (tc: TestCase) => {
    setReplaying(tc.id);
    setResult(null);
    setReplayError(null);
    try {
      const r = await replayCase(tc);
      setResult(r);
      setExpandedId(tc.id);
    } catch (e: unknown) {
      setReplayError(e instanceof Error ? e.message : String(e));
    } finally {
      setReplaying(null);
    }
  }, [replayCase]);

  const handleDelete = useCallback(async (id: string) => {
    await removeTestCase(id);
    if (expandedId === id) setExpandedId(null);
    if (result?.caseId === id) setResult(null);
  }, [removeTestCase, expandedId, result]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  const renderCase = useCallback(({ item: tc }: { item: TestCase }) => {
    const isExpanded = expandedId === tc.id;
    const isThisReplaying = replaying === tc.id;
    const thisResult = result?.caseId === tc.id ? result : null;

    return (
      <Pressable style={styles.card} onPress={() => setExpandedId(isExpanded ? null : tc.id)}>
        <View style={styles.cardHeader}>
          <View style={styles.cardMeta}>
            <Text style={styles.cardLabel} numberOfLines={isExpanded ? 0 : 1}>{tc.label}</Text>
            <Text style={styles.cardDate}>{formatDate(tc.createdAt)}</Text>
          </View>
          <View style={[styles.routeBadge, routeColor(tc.capturedRoute)]}>
            <Text style={styles.routeText}>{tc.capturedRoute.replace('_', ' ')}</Text>
          </View>
        </View>

        {isExpanded && (
          <View style={styles.cardBody}>
            <Section label="Transcript" value={tc.capturedTranscript} />
            <Section label="Original response" value={tc.capturedResponse} />
            {tc.imageBase64 && <Text style={styles.photoTag}>[photo captured]</Text>}

            {thisResult && (
              <View style={styles.replayResult}>
                <Text style={styles.sectionLabel}>Replay result</Text>
                {thisResult.newTranscript !== tc.capturedTranscript && (
                  <Section label="Re-transcribed" value={thisResult.newTranscript} accent />
                )}
                <View style={styles.routeRow}>
                  <Text style={styles.dimText}>Route: </Text>
                  <View style={[styles.routeBadge, routeColor(thisResult.newRoute)]}>
                    <Text style={styles.routeText}>{thisResult.newRoute.replace('_', ' ')}</Text>
                  </View>
                  {thisResult.newRoute !== tc.capturedRoute && (
                    <Text style={styles.changed}> changed</Text>
                  )}
                </View>
                <Section label="New response" value={thisResult.newResponse} accent />
              </View>
            )}

            {replayError && replaying === null && result?.caseId !== tc.id && (
              <Text style={styles.error}>{replayError}</Text>
            )}

            <View style={styles.cardActions}>
              <Pressable
                style={[styles.actionBtn, isThisReplaying && styles.actionBtnDisabled]}
                onPress={() => handleReplay(tc)}
                disabled={isThisReplaying || !modelsReady}
              >
                {isThisReplaying
                  ? <ActivityIndicator size="small" color="#00ff88" />
                  : <Text style={styles.actionText}>Replay</Text>}
              </Pressable>
              <Pressable style={[styles.actionBtn, styles.deleteBtn]} onPress={() => handleDelete(tc.id)}>
                <Text style={[styles.actionText, styles.deleteText]}>Delete</Text>
              </Pressable>
            </View>
          </View>
        )}
      </Pressable>
    );
  }, [expandedId, replaying, result, replayError, modelsReady, handleReplay, handleDelete]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>TEST HARNESS</Text>
        <Pressable
          style={[styles.armBtn, isRecording && styles.armBtnArmed]}
          onPress={handleArm}
        >
          <Text style={styles.armText}>{isRecording ? 'ARMED' : 'ARM'}</Text>
        </Pressable>
      </View>

      <View style={styles.statusBar}>
        {isRecording ? (
          <Text style={styles.statusArmed}>Armed — speak or snap to capture next interaction</Text>
        ) : (
          <Text style={styles.statusIdle}>
            {testCases.length === 0
              ? 'No cases yet — tap ARM then speak or snap while glasses are live'
              : `${testCases.length} test case${testCases.length === 1 ? '' : 's'} · tap ARM to record a new one`}
          </Text>
        )}
      </View>

      {isThinking && (
        <View style={styles.thinking}>
          <ActivityIndicator size="small" color="#00ff88" />
          <Text style={styles.dimText}>Running replay…</Text>
        </View>
      )}

      {testCases.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No test cases recorded yet.</Text>
          <Text style={styles.dimText}>
            Connect the glasses, tap ARM, then speak or snap a photo.{'\n'}
            The interaction will be saved here for replay.
          </Text>
        </View>
      ) : (
        <FlatList
          data={testCases}
          keyExtractor={tc => tc.id}
          renderItem={renderCase}
          contentContainerStyle={styles.list}
        />
      )}
    </SafeAreaView>
  );
}

function Section({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <Text style={[styles.sectionValue, accent && styles.sectionValueAccent]}>{value}</Text>
    </View>
  );
}

function routeColor(route: string): object {
  const map: Record<string, object> = {
    local_answer:   { backgroundColor: '#1a2a1a', borderColor: '#00ff8833' },
    cloud_answer:   { backgroundColor: '#1a1a2a', borderColor: '#4488ff33' },
    vision_query:   { backgroundColor: '#2a1a1a', borderColor: '#ff884433' },
    desktop_action: { backgroundColor: '#2a2a1a', borderColor: '#ffcc0033' },
    clarify:        { backgroundColor: '#1a1a1a', borderColor: '#88888833' },
  };
  return map[route] ?? map.clarify;
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#0a0a0a' },
  header:     { flexDirection: 'row', alignItems: 'center', padding: 16,
                borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  backBtn:    { marginRight: 12 },
  backText:   { color: '#00ff88', fontSize: 14 },
  title:      { flex: 1, color: '#00ff88', fontSize: 16, fontWeight: '700', letterSpacing: 3 },
  armBtn:     { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 6,
                backgroundColor: '#00ff8811', borderWidth: 1, borderColor: '#00ff8844' },
  armBtnArmed:{ backgroundColor: '#ff880011', borderColor: '#ff8800aa' },
  armText:    { color: '#00ff88', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  statusBar:  { padding: 12, borderBottomWidth: 1, borderBottomColor: '#111' },
  statusIdle: { color: '#444', fontSize: 12 },
  statusArmed:{ color: '#ff8800', fontSize: 12, fontWeight: '600' },
  thinking:   { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 8 },
  empty:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyText:  { color: '#fff', fontSize: 16, fontWeight: '600' },
  dimText:    { color: '#444', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  list:       { padding: 12, gap: 10 },
  card:       { backgroundColor: '#111', borderRadius: 10, borderWidth: 1, borderColor: '#1e1e1e',
                overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, gap: 10 },
  cardMeta:   { flex: 1, gap: 4 },
  cardLabel:  { color: '#e0e0e0', fontSize: 14, fontWeight: '500' },
  cardDate:   { color: '#333', fontSize: 11 },
  routeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1 },
  routeText:  { color: '#aaa', fontSize: 10, fontWeight: '600' },
  cardBody:   { padding: 14, paddingTop: 0, gap: 12 },
  section:    { gap: 3 },
  sectionLabel: { color: '#444', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 },
  sectionValue: { color: '#999', fontSize: 13, lineHeight: 18 },
  sectionValueAccent: { color: '#00ff88' },
  photoTag:   { color: '#ff8844', fontSize: 11 },
  replayResult: { borderTopWidth: 1, borderTopColor: '#1e1e1e', paddingTop: 12, gap: 10 },
  routeRow:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  changed:    { color: '#ff8800', fontSize: 10, fontWeight: '600' },
  error:      { color: '#ff4444', fontSize: 12 },
  cardActions:{ flexDirection: 'row', gap: 8 },
  actionBtn:  { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 6,
                backgroundColor: '#00ff8811', borderWidth: 1, borderColor: '#00ff8822' },
  actionBtnDisabled: { opacity: 0.4 },
  actionText: { color: '#00ff88', fontSize: 12, fontWeight: '600' },
  deleteBtn:  { backgroundColor: '#ff444411', borderColor: '#ff444422' },
  deleteText: { color: '#ff4444' },
});
