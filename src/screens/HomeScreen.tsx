import React, { useCallback, useRef, useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Message, JarvisState } from '../hooks/useJarvis';

interface Props {
  onDevMode: () => void;
  jarvis: JarvisState;
}

export function HomeScreen({ onDevMode, jarvis }: Props) {
  const {
    sessionState, isStreaming, isConnecting,
    devices, messages, isThinking, modelsReady,
    permStatus, registered, setupError, transcript, lastRoute,
    laptopOnline, desktopProgress, needsConfirm,
    cloudEnabled, visionEnabled, bridgeEnabled,
    isPhoneListening, currentPlan, activeStepId,
    register, grantPermission, resetPairing, connect, connectSpecific,
    snapAndAsk, disconnect, confirmDesktopAction,
    askText, togglePhoneMic, clearConversation,
  } = jarvis;

  const [input, setInput] = useState('');
  const [pairingOpen, setPairingOpen] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    // Auto-scroll chat to newest message
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [messages.length]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    inputRef.current?.clear();
    Keyboard.dismiss();
    await askText(text);
  }, [input, askText]);

  const renderMessage = useCallback(({ item }: { item: Message }) => {
    const mine = item.role === 'user';
    return (
      <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
        <View style={[styles.bubble, mine ? styles.userBubble : styles.assistantBubble]}>
          {item.source && item.source !== 'local' && !mine && (
            <View style={[styles.sourceTag, tagStyle(item.source)]}>
              <Text style={styles.sourceTagText}>{sourceLabel(item.source)}</Text>
            </View>
          )}
          {item.imageBase64 && (
            <Text style={styles.photoTag}>📷 photo attached</Text>
          )}
          <Text style={mine ? styles.userBubbleText : styles.bubbleText}>{item.content}</Text>
        </View>
      </View>
    );
  }, []);

  // Setup state: not ready → welcome placeholder; ready → main
  if (!modelsReady) {
    return (
      <View style={[styles.container, styles.screen]}>
        <View style={styles.bootWrap}>
          <Text style={styles.bootTitle}>JARVIS</Text>
          <ActivityIndicator color="#b8ff6b" />
          <Text style={styles.bootText}>Booting on-device Gemma…</Text>
          <Text style={styles.bootHint}>
            First launch downloads ~1.6 GB of model weights to your phone. After
            that it runs fully offline.
          </Text>
        </View>
      </View>
    );
  }

  const pairingNeeded = !registered || permStatus !== 'granted';
  const activeStep = currentPlan?.steps.find(s => s.id === activeStepId);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, styles.screen]}
      keyboardVerticalOffset={0}
    >
      <View style={styles.flex}>
        {/* ─── Top bar ─────────────────────────────────────────── */}
        <View style={styles.topBar}>
          <View style={styles.brand}>
            <View style={[styles.brandDot, { backgroundColor: statusColor(sessionState, isPhoneListening) }]} />
            <Text style={styles.brandText}>JARVIS</Text>
            <Text style={styles.brandSub}>·  {isStreaming ? 'GLASSES LIVE' : isPhoneListening ? 'LISTENING' : 'STANDBY'}</Text>
          </View>
          <Pressable onPress={onDevMode} style={styles.devBtn} hitSlop={12}>
            <Text style={styles.devText}>DEV</Text>
          </Pressable>
        </View>

        {/* ─── Integration status row ─────────────────────────── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          <Chip label="Gemma · on-device" active glow />
          <Chip label="Cloud Gemma" active={cloudEnabled} />
          <Chip label="Vision" active={visionEnabled} />
          <Chip
            label={bridgeEnabled ? (laptopOnline ? 'Laptop online' : 'Laptop offline') : 'Laptop'}
            active={bridgeEnabled && laptopOnline === true}
            warn={bridgeEnabled && laptopOnline === false}
          />
          <Chip
            label={registered && permStatus === 'granted' ? 'Glasses paired' : 'Glasses'}
            active={registered && permStatus === 'granted'}
          />
          {lastRoute && <Chip label={`route · ${lastRoute.replace('_', ' ')}`} subtle />}
        </ScrollView>

        {/* ─── Pairing sheet (collapsed by default) ──────────── */}
        {pairingNeeded && (
          <Pressable style={styles.pairBanner} onPress={() => setPairingOpen(v => !v)}>
            <View style={styles.pairBannerRow}>
              <Text style={styles.pairBannerTitle}>
                {registered ? 'Finish glasses setup' : 'Pair Ray-Ban glasses (optional)'}
              </Text>
              <Text style={styles.pairCaret}>{pairingOpen ? '▾' : '▸'}</Text>
            </View>
            <Text style={styles.pairBannerHint}>
              Not required — Jarvis runs as a full assistant on your phone.
            </Text>
          </Pressable>
        )}

        {pairingNeeded && pairingOpen && (
          <View style={styles.pairPanel}>
            {!registered && (
              <>
                <Text style={styles.stepTitle}>Step 1 · Register</Text>
                <Text style={styles.stepHint}>Opens Meta AI to link Jarvis with your glasses.</Text>
                <Pressable style={styles.primaryBtn} onPress={register}>
                  <Text style={styles.primaryBtnText}>Register with Meta AI</Text>
                </Pressable>
              </>
            )}
            {registered && permStatus !== 'granted' && (
              <>
                <Text style={styles.stepTitle}>Step 2 · Grant camera</Text>
                <Text style={styles.stepHint}>
                  Power glasses on and keep them nearby. Permission is approved inside Meta AI.
                </Text>
                <Pressable style={styles.primaryBtn} onPress={grantPermission}>
                  <Text style={styles.primaryBtnText}>Grant camera access</Text>
                </Pressable>
                <Pressable style={styles.secondaryBtn} onPress={connect}>
                  <Text style={styles.secondaryBtnText}>Try connect anyway</Text>
                </Pressable>
                <Pressable style={styles.dangerBtn} onPress={resetPairing}>
                  <Text style={styles.dangerBtnText}>Reset pairing</Text>
                </Pressable>
              </>
            )}
            {setupError && <Text style={styles.errorText}>{setupError}</Text>}
          </View>
        )}

        {/* ─── Glasses connect (when paired + ready) ─────────── */}
        {!pairingNeeded && sessionState === 'stopped' && (
          <View>
            <View style={styles.connectRow}>
              <Pressable style={styles.pillBtn} onPress={connect}>
                <Text style={styles.pillText}>Connect glasses</Text>
              </Pressable>
              {devices.slice(0, 2).map(d => (
                <Pressable key={d.id} style={styles.pillBtnGhost} onPress={() => connectSpecific(d.id)}>
                  <Text style={styles.pillTextGhost}>{d.name}</Text>
                </Pressable>
              ))}
            </View>
            {setupError && (
              <View style={styles.inlineNote}>
                <Text style={styles.inlineNoteText}>{setupError}</Text>
              </View>
            )}
          </View>
        )}

        {isConnecting && (
          <View style={styles.connectRow}>
            <ActivityIndicator color="#ffaa00" />
            <Text style={styles.mutedText}>Waiting for glasses… open Meta AI to wake them.</Text>
            <Pressable style={styles.pillBtnGhost} onPress={disconnect}>
              <Text style={styles.pillTextGhost}>Cancel</Text>
            </Pressable>
          </View>
        )}

        {/* ─── Plan preview (multi-step) ─────────────────────── */}
        {currentPlan && currentPlan.steps.length > 1 && (
          <View style={styles.planCard}>
            <Text style={styles.planTitle}>Plan · {currentPlan.summary}</Text>
            {currentPlan.steps.map((s, i) => {
              const done = activeStepId
                ? currentPlan.steps.findIndex(x => x.id === activeStepId) > i
                : false;
              const active = s.id === activeStepId;
              return (
                <View key={s.id} style={styles.planStep}>
                  <View style={[
                    styles.planDot,
                    done && styles.planDotDone,
                    active && styles.planDotActive,
                  ]} />
                  <View style={styles.flex}>
                    <Text style={[styles.planStepText, active && styles.planStepActive]}>
                      {s.description}
                    </Text>
                    <Text style={styles.planRoute}>{s.route.replace('_', ' ')}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* ─── Chat transcript ───────────────────────────────── */}
        <FlatList
          ref={listRef}
          style={styles.chat}
          data={messages}
          keyExtractor={(_, i) => String(i)}
          renderItem={renderMessage}
          contentContainerStyle={styles.chatContent}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>Ask Jarvis anything</Text>
              <Text style={styles.emptyHint}>
                Type below or tap the mic. Requests route automatically between
                on-device Gemma, cloud Gemma, vision, memory, and your laptop via
                OpenClaw.
              </Text>
              <View style={styles.suggestionRow}>
                <Suggestion text="What can you do?" onPress={askText} />
                <Suggestion text="Plan my afternoon" onPress={askText} />
                <Suggestion text="Draft an email about the demo" onPress={askText} />
              </View>
            </View>
          }
        />

        {/* ─── Status banners above input ────────────────────── */}
        {transcript !== '' && (
          <Text style={styles.transcriptStrip}>heard · {transcript}</Text>
        )}
        {desktopProgress !== '' && (
          <View style={styles.progressBanner}>
            <ActivityIndicator size="small" color="#7ad7ff" />
            <Text style={styles.progressText} numberOfLines={2}>{desktopProgress}</Text>
          </View>
        )}
        {needsConfirm && (
          <View style={styles.confirmBanner}>
            <Text style={styles.confirmTitle}>CONFIRM</Text>
            <Text style={styles.confirmText}>{needsConfirm}</Text>
            <View style={styles.confirmRow}>
              <Pressable style={styles.confirmYes} onPress={() => confirmDesktopAction(true)}>
                <Text style={styles.confirmYesText}>Yes, proceed</Text>
              </Pressable>
              <Pressable style={styles.confirmNo} onPress={() => confirmDesktopAction(false)}>
                <Text style={styles.confirmNoText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        )}
        {isThinking && !desktopProgress && (
          <View style={styles.thinkingRow}>
            <ActivityIndicator size="small" color="#b8ff6b" />
            <Text style={styles.mutedText}>Thinking{activeStep ? ` · ${activeStep.description}` : '…'}</Text>
          </View>
        )}

        {/* ─── Input bar ──────────────────────────────────────── */}
        <View style={styles.inputBar}>
          <Pressable
            style={[styles.micBtn, isPhoneListening && styles.micBtnActive]}
            onPress={togglePhoneMic}
            hitSlop={6}
          >
            <Text style={styles.micIcon}>{isPhoneListening ? '●' : '🎙'}</Text>
          </Pressable>
          <TextInput
            ref={inputRef}
            style={styles.textInput}
            value={input}
            onChangeText={setInput}
            placeholder={isPhoneListening ? 'Listening…' : 'Message Jarvis'}
            placeholderTextColor="#4a4a4a"
            onSubmitEditing={send}
            returnKeyType="send"
            blurOnSubmit
            multiline
            maxLength={2000}
          />
          {isStreaming && (
            <Pressable style={styles.snapBtn} onPress={() => snapAndAsk()}>
              <Text style={styles.snapText}>Snap</Text>
            </Pressable>
          )}
          <Pressable
            style={[styles.sendBtn, !input.trim() && styles.sendBtnDisabled]}
            onPress={send}
            disabled={!input.trim()}
          >
            <Text style={styles.sendText}>Send</Text>
          </Pressable>
        </View>

        {/* ─── Footer actions ─────────────────────────────────── */}
        <View style={styles.footerRow}>
          {isStreaming && (
            <Pressable style={styles.footerBtn} onPress={disconnect}>
              <Text style={styles.footerText}>Disconnect glasses</Text>
            </Pressable>
          )}
          {messages.length > 0 && (
            <Pressable style={styles.footerBtn} onPress={clearConversation}>
              <Text style={styles.footerText}>Clear conversation</Text>
            </Pressable>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const WINDOW = Dimensions.get('window');
const TOP_INSET = Platform.select({
  ios: 54,
  android: StatusBar.currentHeight ?? 24,
  default: 0,
});
const BOTTOM_INSET = Platform.select({ ios: 30, default: 8 });

// ─── Helpers ─────────────────────────────────────────────────────

function Chip({ label, active, warn, glow, subtle }: {
  label: string; active?: boolean; warn?: boolean; glow?: boolean; subtle?: boolean;
}) {
  return (
    <View style={[
      styles.chip,
      active && styles.chipActive,
      warn && styles.chipWarn,
      subtle && styles.chipSubtle,
      glow && styles.chipGlow,
    ]}>
      <View style={[
        styles.chipDot,
        active && styles.chipDotActive,
        warn && styles.chipDotWarn,
      ]} />
      <Text style={[
        styles.chipText,
        active && styles.chipTextActive,
        warn && styles.chipTextWarn,
        subtle && styles.chipTextSubtle,
      ]}>{label}</Text>
    </View>
  );
}

function Suggestion({ text, onPress }: { text: string; onPress: (t: string) => void }) {
  return (
    <Pressable style={styles.suggestion} onPress={() => onPress(text)}>
      <Text style={styles.suggestionText}>{text}</Text>
    </Pressable>
  );
}

function statusColor(state: string, listening: boolean): string {
  if (state === 'streaming') return '#b8ff6b';
  if (state === 'waitingForDevice' || state === 'starting') return '#ffaa00';
  if (listening) return '#b8ff6b';
  return '#333';
}

function sourceLabel(source: string): string {
  return ({
    cloud:   'cloud gemma',
    vision:  'vision',
    desktop: 'laptop',
    local:   'on-device',
  } as Record<string, string>)[source] ?? source;
}

function tagStyle(source: string) {
  return ({
    cloud:   { backgroundColor: '#0f2040', borderColor: '#3b82f666' },
    vision:  { backgroundColor: '#2a1a1a', borderColor: '#f9731666' },
    desktop: { backgroundColor: '#2a2510', borderColor: '#eab30866' },
    local:   { backgroundColor: '#0e1e10', borderColor: '#22c55e66' },
  } as Record<string, object>)[source] ?? {};
}

// ─── Styles ──────────────────────────────────────────────────────

const BG         = '#07080a';
const BG_SOFT    = '#0d1014';
const BG_CARD    = '#11141a';
const BORDER     = '#1a1f27';
const BORDER_HI  = '#252c36';
const TEXT       = '#e7ecef';
const TEXT_DIM   = '#7a8591';
const TEXT_MUTED = '#4a5461';
const ACCENT     = '#b8ff6b';
const ACCENT_DIM = '#b8ff6b22';

const styles = StyleSheet.create({
  flex:        { flex: 1 },
  container:   { flex: 1, backgroundColor: BG },
  screen:      {
    width: WINDOW.width,
    minHeight: WINDOW.height,
    paddingTop: TOP_INSET,
    paddingBottom: BOTTOM_INSET,
    backgroundColor: BG,
  },

  // Boot
  bootWrap:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  bootTitle:   { color: ACCENT, fontSize: 28, fontWeight: '800', letterSpacing: 6 },
  bootText:    { color: TEXT, fontSize: 14 },
  bootHint:    { color: TEXT_MUTED, fontSize: 12, textAlign: 'center', lineHeight: 18, maxWidth: 320 },

  // Top bar
  topBar:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12 },
  brand:       { flexDirection: 'row', alignItems: 'center', flex: 1 },
  brandDot:    { width: 9, height: 9, borderRadius: 5, marginRight: 10 },
  brandText:   { color: TEXT, fontSize: 18, fontWeight: '800', letterSpacing: 4 },
  brandSub:    { color: TEXT_MUTED, fontSize: 10, letterSpacing: 2, marginLeft: 6 },
  devBtn:      { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: BG_SOFT, borderWidth: 1, borderColor: BORDER },
  devText:     { color: TEXT_MUTED, fontSize: 10, fontWeight: '700', letterSpacing: 2 },

  // Chips row
  chipsRow:    { paddingHorizontal: 14, paddingBottom: 10, gap: 6 },
  chip:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: BORDER, backgroundColor: BG_SOFT, marginRight: 6 },
  chipActive:  { borderColor: '#2a4d25', backgroundColor: '#0f1a0c' },
  chipGlow:    { shadowColor: ACCENT, shadowOpacity: 0.4, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  chipWarn:    { borderColor: '#4d2a25', backgroundColor: '#1a0f0c' },
  chipSubtle:  { borderColor: '#1a1f27', backgroundColor: 'transparent' },
  chipDot:     { width: 5, height: 5, borderRadius: 3, backgroundColor: TEXT_MUTED, marginRight: 7 },
  chipDotActive: { backgroundColor: ACCENT },
  chipDotWarn: { backgroundColor: '#ff6b4a' },
  chipText:    { color: TEXT_DIM, fontSize: 11, fontWeight: '500' },
  chipTextActive: { color: ACCENT },
  chipTextWarn: { color: '#ff9988' },
  chipTextSubtle: { color: TEXT_MUTED },

  // Pairing banner
  pairBanner:  { marginHorizontal: 14, marginBottom: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: BG_SOFT },
  pairBannerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pairBannerTitle: { color: TEXT, fontSize: 13, fontWeight: '600' },
  pairBannerHint: { color: TEXT_MUTED, fontSize: 11, marginTop: 3 },
  pairCaret:   { color: TEXT_DIM, fontSize: 14 },

  pairPanel:   { marginHorizontal: 14, marginBottom: 10, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: BORDER_HI, backgroundColor: BG_CARD, gap: 10 },
  stepTitle:   { color: TEXT, fontSize: 14, fontWeight: '700' },
  stepHint:    { color: TEXT_DIM, fontSize: 12, lineHeight: 17 },
  primaryBtn:  { backgroundColor: ACCENT, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  primaryBtnText: { color: '#0a0a0a', fontSize: 13, fontWeight: '700' },
  secondaryBtn:{ backgroundColor: BG_SOFT, borderWidth: 1, borderColor: BORDER_HI, paddingVertical: 11, borderRadius: 8, alignItems: 'center' },
  secondaryBtnText: { color: TEXT, fontSize: 12, fontWeight: '600' },
  dangerBtn:   { backgroundColor: '#2a1010', borderWidth: 1, borderColor: '#4a2020', paddingVertical: 11, borderRadius: 8, alignItems: 'center' },
  dangerBtnText: { color: '#ff8888', fontSize: 12, fontWeight: '600' },
  errorText:   { color: '#ff7777', fontSize: 11, lineHeight: 16 },

  // Glasses connect row
  connectRow:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 6, gap: 8 },
  pillBtn:     { backgroundColor: ACCENT_DIM, borderWidth: 1, borderColor: ACCENT, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  pillText:    { color: ACCENT, fontSize: 11, fontWeight: '700' },
  pillBtnGhost:{ backgroundColor: BG_SOFT, borderWidth: 1, borderColor: BORDER_HI, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  pillTextGhost: { color: TEXT_DIM, fontSize: 11 },
  inlineNote:  { marginHorizontal: 14, marginTop: 4, marginBottom: 8, padding: 10, borderRadius: 8, backgroundColor: '#1f1409', borderWidth: 1, borderColor: '#5a3a1e' },
  inlineNoteText: { color: '#ffb366', fontSize: 11, lineHeight: 16 },

  // Plan card
  planCard:    { marginHorizontal: 14, marginBottom: 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#2a3d25', backgroundColor: '#0d140b', gap: 8 },
  planTitle:   { color: ACCENT, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  planStep:    { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  planDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: BORDER_HI, marginTop: 5 },
  planDotActive: { backgroundColor: ACCENT },
  planDotDone: { backgroundColor: '#3a5a2d' },
  planStepText:{ color: TEXT, fontSize: 13, lineHeight: 18 },
  planStepActive: { color: ACCENT, fontWeight: '600' },
  planRoute:   { color: TEXT_MUTED, fontSize: 10, marginTop: 2, textTransform: 'uppercase', letterSpacing: 1 },

  // Chat
  chat:        { flex: 1 },
  chatContent: { padding: 14, gap: 10, flexGrow: 1 },

  // Empty state
  emptyWrap:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  emptyTitle:  { color: TEXT, fontSize: 18, fontWeight: '600' },
  emptyHint:   { color: TEXT_DIM, fontSize: 13, textAlign: 'center', lineHeight: 19, maxWidth: 320 },
  suggestionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 8 },
  suggestion:  { backgroundColor: BG_SOFT, borderWidth: 1, borderColor: BORDER_HI, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  suggestionText: { color: TEXT_DIM, fontSize: 12 },

  // Bubbles
  bubbleRow:   { flexDirection: 'row', width: '100%' },
  bubbleRowMine:{ justifyContent: 'flex-end' },
  bubble:      { maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16 },
  userBubble:  { backgroundColor: ACCENT, borderBottomRightRadius: 4 },
  assistantBubble: { backgroundColor: BG_CARD, borderWidth: 1, borderColor: BORDER, borderBottomLeftRadius: 4 },
  bubbleText:  { color: TEXT, fontSize: 15, lineHeight: 21 },
  userBubbleText: { color: '#0a0a0a', fontSize: 15, lineHeight: 21, fontWeight: '500' },
  sourceTag:   { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginBottom: 6 },
  sourceTagText: { color: TEXT_DIM, fontSize: 9, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  photoTag:    { color: '#ffaa66', fontSize: 10, marginBottom: 4, fontWeight: '600' },

  // Status strips
  transcriptStrip: { color: TEXT_MUTED, fontSize: 11, paddingHorizontal: 16, paddingBottom: 4, fontStyle: 'italic' },
  thinkingRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  mutedText:   { color: TEXT_DIM, fontSize: 12 },
  progressBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#08141e', borderTopWidth: 1, borderTopColor: '#1e3a5a' },
  progressText:{ color: '#7ad7ff', fontSize: 12, flex: 1, lineHeight: 17 },
  confirmBanner: { padding: 14, backgroundColor: '#1f1409', borderTopWidth: 1, borderTopColor: '#5a3a1e', gap: 8 },
  confirmTitle:{ color: '#ffb366', fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  confirmText: { color: TEXT, fontSize: 14, lineHeight: 20 },
  confirmRow:  { flexDirection: 'row', gap: 8, marginTop: 4 },
  confirmYes:  { flex: 1, backgroundColor: '#1e3a1c', borderWidth: 1, borderColor: '#3a6a2d', borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  confirmYesText: { color: ACCENT, fontSize: 12, fontWeight: '700' },
  confirmNo:   { flex: 1, backgroundColor: '#2a1010', borderWidth: 1, borderColor: '#5a2020', borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  confirmNoText: { color: '#ff8888', fontSize: 12, fontWeight: '700' },

  // Input
  inputBar:    { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, gap: 8, backgroundColor: BG_SOFT, borderTopWidth: 1, borderTopColor: BORDER },
  micBtn:      { width: 40, height: 40, borderRadius: 20, backgroundColor: BG_CARD, borderWidth: 1, borderColor: BORDER_HI, alignItems: 'center', justifyContent: 'center' },
  micBtnActive:{ backgroundColor: ACCENT, borderColor: ACCENT },
  micIcon:     { fontSize: 16, color: TEXT },
  textInput:   { flex: 1, minHeight: 40, maxHeight: 120, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, color: TEXT, fontSize: 15, backgroundColor: BG_CARD, borderRadius: 20, borderWidth: 1, borderColor: BORDER },
  snapBtn:     { paddingHorizontal: 12, height: 40, borderRadius: 20, backgroundColor: BG_CARD, borderWidth: 1, borderColor: BORDER_HI, alignItems: 'center', justifyContent: 'center' },
  snapText:    { color: TEXT_DIM, fontSize: 12, fontWeight: '600' },
  sendBtn:     { paddingHorizontal: 16, height: 40, borderRadius: 20, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: BG_CARD, borderWidth: 1, borderColor: BORDER },
  sendText:    { color: '#0a0a0a', fontSize: 13, fontWeight: '700' },

  // Footer
  footerRow:   { flexDirection: 'row', justifyContent: 'center', gap: 12, paddingBottom: 8 },
  footerBtn:   { paddingHorizontal: 14, paddingVertical: 6 },
  footerText:  { color: TEXT_MUTED, fontSize: 11 },
});
