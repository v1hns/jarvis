import React, { useCallback, useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useJarvis, Message } from '../hooks/useJarvis';
import { MetaDAT } from '../modules/MetaDAT';

export function HomeScreen() {
  const {
    sessionState,
    devices,
    messages,
    isThinking,
    modelsReady,
    transcript,
    scanDevices,
    connectDevice,
    enableVision,
    snapAndAsk,
    disconnect,
  } = useJarvis();

  useEffect(() => {
    MetaDAT.register('com.jarvis.app');
    MetaDAT.requestPermissions();
  }, []);

  const renderMessage = useCallback(({ item }: { item: Message }) => (
    <View style={[styles.bubble, item.role === 'assistant' ? styles.assistantBubble : styles.userBubble]}>
      {item.imageBase64 && (
        <Text style={styles.imageTag}>[photo attached]</Text>
      )}
      <Text style={styles.bubbleText}>{item.content}</Text>
    </View>
  ), []);

  const isConnected = sessionState === 'connected' || sessionState === 'streaming';

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>JARVIS</Text>
        <View style={[styles.statusDot, { backgroundColor: isConnected ? '#00ff88' : '#ff4444' }]} />
        <Text style={styles.statusText}>{sessionState}</Text>
      </View>

      {/* Model loading */}
      {!modelsReady && (
        <View style={styles.loading}>
          <ActivityIndicator color="#00ff88" />
          <Text style={styles.loadingText}>Loading on-device AI models…</Text>
        </View>
      )}

      {/* Device list when idle */}
      {sessionState === 'idle' && modelsReady && (
        <View style={styles.section}>
          <Pressable style={styles.btn} onPress={scanDevices}>
            <Text style={styles.btnText}>Scan for Ray-Ban Glasses</Text>
          </Pressable>
          {devices.map(d => (
            <Pressable key={d.id} style={styles.deviceItem} onPress={() => connectDevice(d.id)}>
              <Text style={styles.deviceName}>{d.name}</Text>
              <Text style={styles.deviceModel}>{d.model} · {d.firmwareVersion}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Active session */}
      {isConnected && (
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

          {isThinking && (
            <View style={styles.thinking}>
              <ActivityIndicator size="small" color="#00ff88" />
              <Text style={styles.thinkingText}>Jarvis is thinking…</Text>
            </View>
          )}

          <View style={styles.toolbar}>
            <Pressable style={styles.btn} onPress={enableVision}>
              <Text style={styles.btnText}>Enable Vision</Text>
            </Pressable>
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
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  title: { color: '#00ff88', fontSize: 22, fontWeight: '700', letterSpacing: 4, marginRight: 12 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusText: { color: '#888', fontSize: 12, textTransform: 'uppercase' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#555', fontSize: 14 },
  section: { padding: 20, gap: 12 },
  deviceItem: {
    padding: 14,
    borderWidth: 1,
    borderColor: '#00ff8844',
    borderRadius: 8,
    backgroundColor: '#111',
  },
  deviceName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  deviceModel: { color: '#555', fontSize: 12, marginTop: 2 },
  chat: { flex: 1, padding: 16 },
  bubble: {
    maxWidth: '80%',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#1a3a2a' },
  assistantBubble: { alignSelf: 'flex-start', backgroundColor: '#1a1a1a' },
  bubbleText: { color: '#e0e0e0', fontSize: 15, lineHeight: 21 },
  imageTag: { color: '#00ff88', fontSize: 11, marginBottom: 4 },
  transcript: { color: '#444', fontSize: 12, paddingHorizontal: 16, paddingBottom: 4 },
  thinking: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 8,
  },
  thinkingText: { color: '#555', fontSize: 13 },
  toolbar: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  btn: {
    flex: 1,
    backgroundColor: '#00ff8822',
    borderWidth: 1,
    borderColor: '#00ff8866',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  btnDanger: { backgroundColor: '#ff444422', borderColor: '#ff444466' },
  btnText: { color: '#00ff88', fontSize: 13, fontWeight: '600' },
});
