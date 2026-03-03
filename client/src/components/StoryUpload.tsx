import { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { X, Camera, Image as ImageIcon, Type, Send } from 'lucide-react';

interface Props {
  onClose: () => void;
  onPublished: () => void;
}

const BG_COLORS = [
  'rgba(0,0,0,0.6)', '#6C63FF', '#FF6584', '#43AA8B',
  '#F9844A', '#577590', '#F94144', '#90BE6D',
];

export default function StoryUpload({ onClose, onPublished }: Props) {
  const { token } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  const [textOverlay, setTextOverlay] = useState('');
  const [showTextInput, setShowTextInput] = useState(false);
  const [bgColor, setBgColor] = useState(BG_COLORS[0]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setIsVideo(f.type.startsWith('video/'));
    setPreview(URL.createObjectURL(f));
  };

  const publish = async () => {
    if (!file) return;
    setUploading(true);

    try {
      const form = new FormData();
      form.append('file', file);
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!uploadRes.ok) throw new Error('Upload failed');
      const { fileUrl } = await uploadRes.json();

      const storyRes = await fetch('/api/stories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          type: isVideo ? 'video' : 'image',
          fileUrl,
          textOverlay,
          bgColor: textOverlay ? bgColor : '',
        }),
      });

      if (storyRes.ok) {
        onPublished();
        onClose();
      }
    } catch (err) {
      alert('Ошибка при публикации');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="story-upload-overlay">
      <div className="story-upload">
        <div className="story-upload-header">
          <button className="story-action-btn" onClick={onClose}><X size={22} /></button>
          <span>Новая история</span>
          {preview && (
            <button
              className="story-publish-btn"
              onClick={publish}
              disabled={uploading}
            >
              {uploading ? '...' : <><Send size={16} /> Опубликовать</>}
            </button>
          )}
        </div>

        {!preview ? (
          <div className="story-upload-picker">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
              capture="environment"
            />
            <button className="story-picker-btn" onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.removeAttribute('capture');
                fileInputRef.current.click();
              }
            }}>
              <ImageIcon size={36} />
              <span>Выбрать из галереи</span>
            </button>
            <button className="story-picker-btn" onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.setAttribute('capture', 'environment');
                fileInputRef.current.click();
              }
            }}>
              <Camera size={36} />
              <span>Сделать фото</span>
            </button>
          </div>
        ) : (
          <div className="story-upload-preview">
            {isVideo ? (
              <video src={preview} className="story-preview-media" controls playsInline />
            ) : (
              <img src={preview} className="story-preview-media" alt="" />
            )}

            {textOverlay && (
              <div className="story-text-overlay" style={{ background: bgColor }}>
                {textOverlay}
              </div>
            )}

            <div className="story-upload-tools">
              <button
                className={`story-tool-btn ${showTextInput ? 'active' : ''}`}
                onClick={() => setShowTextInput(!showTextInput)}
              >
                <Type size={20} />
              </button>
            </div>

            {showTextInput && (
              <div className="story-text-editor" onClick={(e) => e.stopPropagation()}>
                <input
                  type="text"
                  placeholder="Добавить текст..."
                  value={textOverlay}
                  onChange={(e) => setTextOverlay(e.target.value)}
                  autoFocus
                  maxLength={120}
                />
                <div className="story-color-picker">
                  {BG_COLORS.map((c) => (
                    <button
                      key={c}
                      className={`story-color-btn ${bgColor === c ? 'active' : ''}`}
                      style={{ background: c }}
                      onClick={() => setBgColor(c)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
