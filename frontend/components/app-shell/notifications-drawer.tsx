'use client';
// Notifications in a shadcn Drawer sliding in from the right (user, 31 Oct). Trigger lives in the sidebar or header.
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Badge } from "@/components/ui/badge";
import { NotificationsList, useNotificationFeed } from "@/components/app-shell/notifications-list";

export default function NotificationsDrawer({ trigger }: { trigger: React.ReactNode }) {
  const feed = useNotificationFeed();
  return (
    <Drawer direction="right">
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent className="flex flex-col">
        <DrawerHeader className="border-b">
          <DrawerTitle className="flex items-center gap-2">
            Notifications
            <Badge variant="secondary" className="font-mono tabular-nums">{feed.recent}</Badge>
          </DrawerTitle>
          <DrawerDescription>Newest first. Count shows the last 10 minutes.</DrawerDescription>
        </DrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col p-2">
          <NotificationsList feed={feed} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
