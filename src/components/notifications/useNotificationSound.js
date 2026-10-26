import {useMemo,useSyncExternalStore} from 'react';
import {notificationSoundFor} from '../../services/notificationSound.js';
export default function useNotificationSound(identity) {
 const client=useMemo(()=>notificationSoundFor(identity),[identity]);
 const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot);
 return {client,...state};
}
