import { User } from "lucide-react";
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
import { hasAuthCookies, readCookie } from "~/lib/client/cookies";
import { Cookie } from "~/lib/cookies";

/** Auth chrome — Radix DropdownMenu; menü API'den gelmez. */
export default function UserChrome() {
  if (!hasAuthCookies()) {
    return (
      <Button variant="secondary" size="sm" asChild>
        <a href="/giris">Giriş yap</a>
      </Button>
    );
  }

  const accountText = readCookie(Cookie.accountText) ?? "Hesabım";
  const initials = accountText.slice(0, 2).toUpperCase();

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
