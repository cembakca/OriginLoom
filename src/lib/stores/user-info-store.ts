export type UserInfo = {
  isSignedIn: boolean;
  displayName?: string;
  initials?: string;
};

type Listener = () => void;

let userInfo: UserInfo = { isSignedIn: false };
const listeners = new Set<Listener>();

export function seedUserInfo(info: Partial<UserInfo>): void {
  userInfo =
    info.isSignedIn === false
      ? { isSignedIn: false }
      : {
          ...userInfo,
          ...info,
        };
  for (const listener of listeners) listener();
}

export function getUserInfo(): UserInfo {
  return userInfo;
}

export function subscribeUserInfo(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
