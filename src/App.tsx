import React, { useState } from 'react';
import { StatusBar } from 'react-native';
import { HomeScreen } from './screens/HomeScreen';
import { TestScreen } from './screens/TestScreen';

export default function App() {
  const [showTestScreen, setShowTestScreen] = useState(false);

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
      {showTestScreen
        ? <TestScreen onBack={() => setShowTestScreen(false)} />
        : <HomeScreen onDevMode={() => setShowTestScreen(true)} />}
    </>
  );
}
