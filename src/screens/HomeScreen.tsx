import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
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
    register, grantPermission, resetPairing, connect, connectSpecific,
    snapAndAsk, disconnect, confirmDesktopAction,
  } = jarvis;

  const renderMessage = useCallback(({ item }: { item: Message }) => (
    <View style={[styles.bubble, item.role === 'assistant' ? styles.assistantBubble : styles.userBubble]}>
      {item.imageBase64 && <Text style={styles.tag}>[photo]</Text>}
      {item.source && item.source !== 'local' && (
        <Text style={styles.tag}>[{item.source}]</Text>
      )}
      <Text style={styles.bubbleText}>{item.content}</Text>
    </View>
  ), []);

  return (
    <SafeAreaView style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>JARVIS</Text>
        <View style={[styles.dot, {
          backgroundColor: isStreaming ? '#00ff88' : isConnecting ? '#ffaa00' : '#333'
        }]} />
        <Text style={styles.status}>{sessionState}</Text>
        {lastRoute && <Text style={styles.route}> · {lastRoute}</Text>}
        {laptopOnline !== null && (
          <View style={[styles.laptopDot, { backgroundColor: laptopOnline ? '#00ff88' : '#555' }]} />
        )}
        <Pressable onPress={onDevMode} style={styles.devBtn}>
          <Text style={styles.devText}>DEV</Text>
        </Pressable>
      </View>

      {/* Loading models */}
      {!modelsReady && (
        <View style={styles.center}>
          <ActivityIndicator color="#00ff88" />
          <Text style={styles.hint}>Loading on-device AI…</Text>
        </View>
      )}

      {/* Setup — register → (glasses on) → grant camera → connect */}
      {modelsReady && (permStatus === 'unknown' || permStatus === 'denied') && !registered && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Step 1 — Pair with Meta AI</Text>
          <Text style={styles.hint}>Opens the Meta AI app to pair Jarvis with your Ray-Ban glasses.</Text>
          {setupError && <Text style={styles.errorText}>{setupError}</Text>}
          <Pressable style={styles.btn} onPress={register}>
            <Text style={styles.btnTextVisible}>Register with Meta AI App</Text>
          </Pressable>
        </View>
      )}

      {modelsReady && permStatus !== 'granted' && registered && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Step 2 — Grant Camera Access</Text>
          <Text style={styles.hint}>
            Power on your glasses and put them nearby. Camera permission is
            granted through the glasses. If Meta AI shows "Something went
            wrong," the saved pairing is stale — tap Reset Pairing and start
            again.
          </Text>
          {setupError && <Text style={styles.errorText}>{setupError}</Text>}
          <Pressable style={styles.btn} onPress={grantPermission}>
            <Text style={styles.btnTextVisible}>Grant Camera Access</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={connect}>
            <Text style={styles.btnText}>Try Connect Anyway</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnDanger]} onPress={resetPairing}>
            <Text style={styles.btnText}>Reset Pairing</Text>
          </Pressable>
        </View>
      )}

      {/* Connect */}
      {modelsReady && permStatus === 'granted' && sessionState === 'stopped' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ready</Text>
          <Pressable style={styles.btn} onPress={connect}>
            <Text style={styles.btnText}>Connect to Glasses</Text>
          </Pressable>
          {devices.length > 0 && (
            <>
              <Text style={[styles.hint, { marginTop: 16 }]}>Or pick a device:</Text>
              {devices.map(d => (
                <Pressable key={d.id} style={styles.deviceItem} onPress={() => connectSpecific(d.id)}>
                  <Text style={styles.deviceName}>{d.name}</Text>
                  <Text style={styles.deviceMeta}>{d.model}</Text>
                </Pressable>
              ))}
            </>
          )}
        </View>
      )}

      {/* Connecting */}
      {isConnecting && (
        <View style={styles.center}>
          <ActivityIndicator color="#ffaa00" />
          <Text style={styles.hint}>Waiting for glasses…</Text>
        </View>
      )}

      {/* Active session */}
      {isStreaming && (
        <>
          <FlatList
            style={styles.chat}
            data={messages}
            keyExtractor={(_, i) => String(i)}
            renderItem={renderMessage}
            contentContainerStyle={{ paddingBottom: 16 }}
          />

          {transcript !== '' && (
            <Text style={styles.transcript}>Heard: {transcript}</Text>
          )}

          {/* Desktop progress banner */}
          {desktopProgress !== '' && (
            <View style={styles.progressBanner}>
              <ActivityIndicator size="small" color="#00aaff" style={{ marginRight: 8 }} />
              <Text style={styles.progressText}>{desktopProgress}</Text>
            </View>
          )}

          {/* Desktop confirmation prompt */}
          {needsConfirm && (
            <View style={styles.confirmBanner}>
              <Text style={styles.confirmTitle}>Confirm action</Text>
              <Text style={styles.confirmText}>{needsConfirm}</Text>
              <View style={styles.confirmRow}>
                <Pressable style={[styles.btn, styles.confirmYes]} onPress={() => confirmDesktopAction(true)}>
                  <Text style={styles.btnText}>Yes, do it</Text>
                </Pressable>
                <Pressable style={[styles.btn, styles.btnDanger]} onPress={() => confirmDesktopAction(false)}>
                  <Text style={styles.btnText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          )}

          {isThinking && !desktopProgress && (
            <View style={styles.thinking}>
              <ActivityIndicator size="small" color="#00ff88" />
              <Text style={styles.hint}>Thinking…</Text>
            </View>
          )}

          <View style={styles.toolbar}>
            <Pressable style={styles.btn} onPress={() => snapAndAsk()}>
              <Text style={styles.btnText}>Snap + Ask</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnDanger]} onPress={disconnect}>
              <Text style={styles.btnText}>Disconnect</Text>
            </Pressable>
          </View>
        </>
      )}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0a0a0a' },
  header:         { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  title:          { color: '#00ff88', fontSize: 22, fontWeight: '700', letterSpacing: 4, marginRight: 12 },
  dot:            { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  laptopDot:      { width: 6, height: 6, borderRadius: 3, marginLeft: 8 },
  status:         { color: '#555', fontSize: 12, textTransform: 'uppercase' },
  route:          { color: '#333', fontSize: 11 },
  center:         { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  section:        { padding: 24, gap: 12 },
  sectionTitle:   { color: '#fff', fontSize: 18, fontWeight: '600' },
  hint:           { color: '#555', fontSize: 13, lineHeight: 18 },
  deviceItem:     { padding: 14, borderWidth: 1, borderColor: '#00ff8822', borderRadius: 8, backgroundColor: '#111' },
  deviceName:     { color: '#fff', fontSize: 15, fontWeight: '600' },
  deviceMeta:     { color: '#444', fontSize: 12, marginTop: 2 },
  chat:           { flex: 1, padding: 16 },
  bubble:         { maxWidth: '80%', borderRadius: 12, padding: 12, marginBottom: 8 },
  userBubble:        { alignSelf: 'flex-end', backgroundColor: '#1a3a2a' },
  assistantBubble:   { alignSelf: 'flex-start', backgroundColor: '#1a1a1a' },
  bubbleText:     { color: '#e0e0e0', fontSize: 15, lineHeight: 21 },
  tag:            { color: '#00ff88', fontSize: 10, marginBottom: 3 },
  transcript:     { color: '#2a2a2a', fontSize: 12, paddingHorizontal: 16, paddingBottom: 4 },
  thinking:       { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 },
  toolbar:        { flexDirection: 'row', padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  errorText:      { color: '#ff4444', fontSize: 12, lineHeight: 16, marginBottom: 4 },
  btn:            { flex: 1, backgroundColor: '#00ff8811', borderWidth: 1, borderColor: '#00ff8833', borderRadius: 8, padding: 14, alignItems: 'center' },
  btnDanger:      { backgroundColor: '#ff444411', borderColor: '#ff444433' },
  btnText:        { color: '#00ff88', fontSize: 13, fontWeight: '600' },
  btnTextVisible: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
  progressBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#001a2a', paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#00aaff22' },
  progressText:   { color: '#00aaff', fontSize: 13, flex: 1 },
  confirmBanner:  { backgroundColor: '#1a0a00', padding: 16, borderTopWidth: 1, borderTopColor: '#ff880033', gap: 8 },
  confirmTitle:   { color: '#ffaa00', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  confirmText:    { color: '#e0e0e0', fontSize: 14, lineHeight: 20 },
  confirmRow:     { flexDirection: 'row', gap: 8, marginTop: 4 },
  confirmYes:     { backgroundColor: '#00442211', borderColor: '#00884433' },
  devBtn:         { marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 4 },
  devText:        { color: '#1e1e1e', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
});
