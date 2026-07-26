import { getUserInfo, subscribeUserInfo } from "@originloom/shared/lib/stores/user-info-store";
import { useSyncExternalStore } from "react";

import { User } from "~/components/icons";
import { Button } from "~/components/ui/button";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

/** Auth chrome — UI hints render immediately, authoritative session updates the store. */
export default function UserChrome() {
  const user = useSyncExternalStore(subscribeUserInfo, getUserInfo, getUserInfo);

  if (!user.isSignedIn) {
    return (
      <Button variant="secondary" size="sm" asChild className="min-w-[5.5rem]">
        <a href="/giris">Giriş yap</a>
      </Button>
    );
  }

  const accountText = user.displayName ?? "Hesabım";
  const initials = user.initials ?? accountText.slice(0, 2).toUpperCase();

  return (
    <DropdownMenuRoot>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="icon" className="rounded-full" aria-label="Hesap menüsü">
          <span className="text-xs font-bold text-brand-700">{initials}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{accountText}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLinkItem href="/hesabim">Hesabım</DropdownMenuLinkItem>
        <DropdownMenuItem disabled>
          <User className="mr-2 h-4 w-4" />
          Profil
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuRoot>
  );
}
