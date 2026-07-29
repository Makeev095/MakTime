import { useEffect } from 'react';
import { useSocket } from '../context/SocketContext';
import { startIncomingRingtone, stopCallRingtone } from '../utils/callRingtone';
import { Phone, PhoneOff } from 'lucide-react';

interface Props {
  onAccept: () => void;
}

export default function IncomingCallModal({ onAccept }: Props) {
  const { socket, incomingCall, setIncomingCall } = useSocket();

  useEffect(() => {
    if (!incomingCall) {
      stopCallRingtone();
      return;
    }
    const stop = startIncomingRingtone();
    return () => {
      stop();
      stopCallRingtone();
    };
  }, [incomingCall]);

  if (!incomingCall) return null;

  const handleReject = () => {
    stopCallRingtone();
    socket?.emit('call:reject', { to: incomingCall.from });
    setIncomingCall(null);
  };

  const handleAccept = () => {
    stopCallRingtone();
    onAccept();
    setIncomingCall(null);
  };

  return (
    <div className="incoming-call-overlay">
      <div className="incoming-call-modal">
        <div className="incoming-call-pulse" />
        <div className="incoming-call-info">
          <h3>Входящий видеозвонок</h3>
          <p>{incomingCall.callerName}</p>
        </div>
        <div className="incoming-call-actions">
          <button className="call-action-btn reject" onClick={handleReject}>
            <PhoneOff size={28} />
          </button>
          <button className="call-action-btn accept" onClick={handleAccept}>
            <Phone size={28} />
          </button>
        </div>
      </div>
    </div>
  );
}
