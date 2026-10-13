import { useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [count, setCount] = useState(0);

  return (
    <button type="button" onClick={() => setCount(value => value + 1)}>
      Clicked {count} times
    </button>
  );
}

createRoot(document.getElementById('app')!).render(<App />);
