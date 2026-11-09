import React from 'react';
import { HomeScreen } from './src/screens/HomeScreen';
import { AppearanceProvider } from './src/store/appearance';

export default function App() {
  return <AppearanceProvider><HomeScreen /></AppearanceProvider>;
}
