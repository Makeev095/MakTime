const EMOJI_LIST = [
  '😀', '😂', '🤣', '😊', '😍', '🥰', '😘', '😎', '🤔', '😐',
  '😏', '😢', '😭', '😡', '🤯', '😱', '🥳', '🤩', '😴', '🤮',
  '👍', '👎', '👏', '🙏', '💪', '🤝', '✌️', '🤟', '👋', '🖐️',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '💯', '🔥',
  '⭐', '🌟', '✨', '💫', '🎉', '🎊', '🎈', '🎁', '🏆', '🥇',
  '✅', '❌', '⚠️', '💡', '📌', '🔔', '⏰', '📸', '🎵', '🎮',
];

interface Props {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export default function EmojiPicker({ onSelect, onClose }: Props) {
  return (
    <div className="emoji-picker">
      <div className="emoji-picker-header">
        <span>Эмодзи</span>
        <button onClick={onClose} className="emoji-close">&times;</button>
      </div>
      <div className="emoji-grid">
        {EMOJI_LIST.map((emoji) => (
          <button
            key={emoji}
            className="emoji-item"
            onClick={() => { onSelect(emoji); onClose(); }}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
