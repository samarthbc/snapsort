import { useState } from 'preact/hooks';
import { DeleteFolder } from './DeleteFolder';
import { ReviewScreen } from './ReviewScreen';

type View = 'closed' | 'review' | 'deleteFolder';

export function App() {
  const [view, setView] = useState<View>('closed');

  if (view === 'closed') {
    return (
      <button
        class="launch"
        type="button"
        onClick={() => setView('review')}
        aria-label="Open SnapSort"
      >
        SnapSort
      </button>
    );
  }

  if (view === 'deleteFolder') {
    return <DeleteFolder onBack={() => setView('review')} onClose={() => setView('closed')} />;
  }

  return (
    <ReviewScreen
      onClose={() => setView('closed')}
      onOpenDeleteFolder={() => setView('deleteFolder')}
    />
  );
}
