export type UserInfo = {
  isSignedIn: boolean;
  displayName?: string;
  initials?: string;
};

let userInfo: UserInfo = { isSignedIn: false };

export function seedUserInfo(info: Partial<UserInfo>): void {
  userInfo = { ...userInfo, ...info };
}

export function getUserInfo(): UserInfo {
  return userInfo;
}
