# Notification Center Enhancements
## The1 Platform - Enhanced Notification Center Implementation Plan

**Status**: 📋 Planning  
**Version**: 1.0  
**Last Updated**: January 2025  
**Priority**: P1 (High - UX Enhancement)  
**Related Documentation**: [Messaging Thread & Push Notifications](./MESSAGING-THREAD-AND-PUSH-NOTIFICATIONS.md)

---

## Overview

This document outlines the implementation plan for enhancing the Notification Center feature. The basic notification center is already implemented (see [Messaging Thread & Push Notifications](./MESSAGING-THREAD-AND-PUSH-NOTIFICATIONS.md)), but this plan focuses on improving the user experience with better organization, visual design, filtering, and enhanced functionality.

---

## Executive Summary

### Current State

**Already Implemented:**
- ✅ Notification list screen (`mobile/app/notifications.js`)
- ✅ Read/unread status display
- ✅ Mark as read functionality
- ✅ Mark all as read
- ✅ Deep linking to relevant screens (COE, messages, payments)
- ✅ Pull-to-refresh
- ✅ Unread count display
- ✅ Backend API endpoints (`server/routes/notifications.js`)

**What Needs Enhancement:**
- 📋 Visual design and organization (date grouping, icons)
- 📋 Filtering and search capabilities
- 📋 Navigation integration (badge on tabs/header)
- 📋 Additional actions (delete, batch operations)
- 📋 Enhanced object access (rich previews, quick actions)

### Key Goals

1. **Better Organization**: Group notifications by date and type for easier navigation
2. **Visual Clarity**: Icons, color coding, and better read/unread distinction
3. **Quick Access**: Navigation badge and easy access from any screen
4. **Enhanced Actions**: Swipe actions, batch operations, delete functionality
5. **Rich Previews**: Show related object information directly in notifications

---

## Current Implementation Reference

### Backend API Endpoints

**Existing Endpoints** (`server/routes/notifications.js`):

1. **GET /v1/notifications**
   - Get user's notification history
   - Query params: `read`, `type`, `page`, `limit`
   - Returns: `{ success: true, data: { notifications: [], pagination: {}, unread_count: 0 } }`

2. **PUT /v1/notifications/:notificationId/read**
   - Mark notification as read
   - Returns: `{ success: true, data: { notification: {...} } }`

3. **PUT /v1/notifications/read-all**
   - Mark all notifications as read
   - Returns: `{ success: true, message: "All notifications marked as read" }`

4. **GET /v1/notifications/unread-count**
   - Get unread notification count
   - Returns: `{ success: true, data: { unread_count: 0 } }`

### Mobile Implementation

**Current Screen** (`mobile/app/notifications.js`):
- Displays flat list of notifications
- Shows read/unread status with visual indicators
- Handles deep linking navigation
- Supports pull-to-refresh
- Has "Mark all as read" functionality

**Deep Link Handling** (`mobile/app/_layout.js`):
- Routes notifications to appropriate screens:
  - `coe-detail` → COE detail screen
  - `coe-messages` → Message thread screen
  - `payment-detail` → Payment detail screen
  - `payment` → Payment screen
  - `coes` → COE list
  - `notifications` → Notification center

---

## Implementation Plan

### Phase 1: Visual Enhancements & Organization (Priority: High)

**Estimated Time**: 8-12 hours  
**Goal**: Improve visual design and organize notifications for better UX

#### 1.1 Notification Grouping by Date

**Description**: Group notifications by time periods for easier scanning.

**Implementation**:

**Mobile** (`mobile/app/notifications.js`):
- Add date grouping logic:
  ```javascript
  const groupNotificationsByDate = (notifications) => {
    const groups = {
      today: [],
      yesterday: [],
      thisWeek: [],
      thisMonth: [],
      older: []
    };
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const thisWeek = new Date(today);
    thisWeek.setDate(thisWeek.getDate() - 7);
    const thisMonth = new Date(today);
    thisMonth.setMonth(thisMonth.getMonth() - 1);
    
    notifications.forEach(notif => {
      const notifDate = new Date(notif.created_at);
      if (notifDate >= today) {
        groups.today.push(notif);
      } else if (notifDate >= yesterday) {
        groups.yesterday.push(notif);
      } else if (notifDate >= thisWeek) {
        groups.thisWeek.push(notif);
      } else if (notifDate >= thisMonth) {
        groups.thisMonth.push(notif);
      } else {
        groups.older.push(notif);
      }
    });
    
    return groups;
  };
  ```

- Update FlatList to use SectionList:
  ```javascript
  import { SectionList } from 'react-native';
  
  const sections = [
    { title: 'Today', data: grouped.today },
    { title: 'Yesterday', data: grouped.yesterday },
    { title: 'This Week', data: grouped.thisWeek },
    { title: 'This Month', data: grouped.thisMonth },
    { title: 'Older', data: grouped.older }
  ].filter(section => section.data.length > 0);
  ```

- Add section header component:
  ```javascript
  const renderSectionHeader = ({ section }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{section.title}</Text>
    </View>
  );
  ```

**Files to Modify**:
- `mobile/app/notifications.js` - Add grouping logic and SectionList

**Styling**:
- Section headers: Dark background, gold text, padding
- Section separators: Subtle border between sections

#### 1.2 Notification Type Icons

**Description**: Add visual icons for each notification type to improve quick recognition.

**Implementation**:

**Mobile** (`mobile/app/notifications.js`):
- Create icon mapping:
  ```javascript
  import { Ionicons } from '@expo/vector-icons';
  
  const getNotificationIcon = (type) => {
    const iconMap = {
      // COE Status
      'coe_sent': 'document-text',
      'coe_approved': 'checkmark-circle',
      'coe_accepted': 'checkmark-done-circle',
      'coe_rejected': 'close-circle',
      'coe_paid': 'card',
      'coe_completed': 'trophy',
      'coe_cancelled': 'ban',
      'coe_expired': 'time',
      // Messaging
      'coe_message': 'chatbubble',
      // Payment
      'payment_received': 'cash',
      'payment_failed': 'alert-circle',
      // Runner
      'runner_assigned': 'person-add',
      'runner_updated': 'person'
    };
    return iconMap[type] || 'notifications';
  };
  
  const getNotificationIconColor = (type) => {
    const colorMap = {
      'coe_approved': colors.success,
      'coe_paid': colors.gold,
      'coe_completed': colors.gold,
      'coe_message': colors.primary,
      'payment_received': colors.success,
      'payment_failed': colors.error,
      'runner_assigned': colors.info
    };
    return colorMap[type] || colors.textSecondary;
  };
  ```

- Update notification item render:
  ```javascript
  const renderNotification = ({item}) => {
    const isUnread = !item.read;
    const iconName = getNotificationIcon(item.type);
    const iconColor = getNotificationIconColor(item.type);
    
    return (
      <TouchableOpacity
        style={[styles.notificationItem, isUnread && styles.unreadItem]}
        onPress={() => handleNotificationPress(item)}>
        <View style={styles.iconContainer}>
          <Ionicons name={iconName} size={24} color={iconColor} />
        </View>
        <View style={styles.notificationContent}>
          {/* ... existing content ... */}
        </View>
        {isUnread && <View style={styles.unreadDot} />}
      </TouchableOpacity>
    );
  };
  ```

**Files to Modify**:
- `mobile/app/notifications.js` - Add icon rendering

**Dependencies**:
- `@expo/vector-icons` (already installed with Expo)

#### 1.3 Enhanced Read/Unread Visual Design

**Description**: Improve visual distinction between read and unread notifications.

**Implementation**:

**Mobile** (`mobile/app/notifications.js`):
- Update styles:
  ```javascript
  const styles = StyleSheet.create({
    notificationItem: {
      flexDirection: 'row',
      backgroundColor: colors.cardBackground,
      borderRadius: 8,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.borderLight,
      opacity: 0.8, // Read notifications slightly faded
    },
    unreadItem: {
      borderColor: colors.gold,
      borderWidth: 2,
      opacity: 1,
      backgroundColor: colors.cardBackground + 'FF', // Full opacity
    },
    notificationTitle: {
      fontSize: 16,
      fontWeight: '500', // Regular weight for read
      color: colors.textPrimary,
    },
    unreadTitle: {
      fontWeight: '700', // Bold for unread
      color: colors.textPrimary,
    },
    notificationBody: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    unreadBody: {
      color: colors.textPrimary, // Darker for unread
    },
    // ... existing styles ...
  });
  ```

**Files to Modify**:
- `mobile/app/notifications.js` - Update styles

---

### Phase 2: Filtering & Search (Priority: Medium)

**Estimated Time**: 6-8 hours  
**Goal**: Allow users to filter and search notifications

#### 2.1 Filter Tabs

**Description**: Add filter tabs to quickly view notifications by type or status.

**Implementation**:

**Mobile** (`mobile/app/notifications.js`):
- Add filter state:
  ```javascript
  const [activeFilter, setActiveFilter] = useState('all');
  
  const filters = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread' },
    { key: 'coe', label: 'COE Updates' },
    { key: 'messages', label: 'Messages' },
    { key: 'payments', label: 'Payments' },
    { key: 'runner', label: 'Runner' }
  ];
  ```

- Add filter tabs component:
  ```javascript
  const renderFilterTabs = () => (
    <ScrollView 
      horizontal 
      showsHorizontalScrollIndicator={false}
      style={styles.filterTabs}
      contentContainerStyle={styles.filterTabsContent}>
      {filters.map(filter => (
        <TouchableOpacity
          key={filter.key}
          style={[
            styles.filterTab,
            activeFilter === filter.key && styles.filterTabActive
          ]}
          onPress={() => setActiveFilter(filter.key)}>
          <Text style={[
            styles.filterTabText,
            activeFilter === filter.key && styles.filterTabTextActive
          ]}>
            {filter.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
  ```

- Update loadNotifications to use filters:
  ```javascript
  const loadNotifications = useCallback(async (page = 1, showLoading = true) => {
    try {
      // ... existing code ...
      
      const params = new URLSearchParams({
        page: page.toString(),
        limit: pagination.limit.toString(),
      });
      
      // Add filter params
      if (activeFilter === 'unread') {
        params.append('read', 'false');
      } else if (activeFilter === 'coe') {
        params.append('type', 'coe_approved,coe_paid,coe_completed,coe_cancelled,coe_rejected,coe_expired');
      } else if (activeFilter === 'messages') {
        params.append('type', 'coe_message');
      } else if (activeFilter === 'payments') {
        params.append('type', 'payment_received,payment_failed');
      } else if (activeFilter === 'runner') {
        params.append('type', 'runner_assigned,runner_updated');
      }
      
      const response = await apiGet(`/notifications?${params.toString()}`);
      // ... rest of existing code ...
    }
  }, [activeFilter, pagination.limit]);
  ```

**Files to Modify**:
- `mobile/app/notifications.js` - Add filter tabs and logic

**Backend** (if needed):
- `server/routes/notifications.js` - May need to handle comma-separated type filter

#### 2.2 Search Functionality

**Description**: Allow users to search notifications by title, body, or related object name.

**Implementation**:

**Mobile** (`mobile/app/notifications.js`):
- Add search state:
  ```javascript
  const [searchQuery, setSearchQuery] = useState('');
  ```

- Add search input:
  ```javascript
  import { TextInput } from 'react-native';
  
  const renderSearchBar = () => (
    <View style={styles.searchContainer}>
      <Ionicons name="search" size={20} color={colors.textSecondary} style={styles.searchIcon} />
      <TextInput
        style={styles.searchInput}
        placeholder="Search notifications..."
        placeholderTextColor={colors.textMuted}
        value={searchQuery}
        onChangeText={setSearchQuery}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {searchQuery.length > 0 && (
        <TouchableOpacity onPress={() => setSearchQuery('')}>
          <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      )}
    </View>
  );
  ```

- Add search filter logic:
  ```javascript
  const filterNotificationsBySearch = (notifications, query) => {
    if (!query.trim()) return notifications;
    
    const lowerQuery = query.toLowerCase();
    return notifications.filter(notif => {
      const titleMatch = notif.title?.toLowerCase().includes(lowerQuery);
      const bodyMatch = notif.body?.toLowerCase().includes(lowerQuery);
      return titleMatch || bodyMatch;
    });
  };
  
  // Apply search filter to displayed notifications
  const displayedNotifications = filterNotificationsBySearch(notifications, searchQuery);
  ```

**Files to Modify**:
- `mobile/app/notifications.js` - Add search functionality

**Note**: This is client-side search. For large notification lists, consider backend search API.

---

### Phase 3: Navigation Integration (Priority: High)

**Estimated Time**: 4-6 hours  
**Goal**: Add notification badge to navigation for quick access

#### 3.1 Unread Badge on Navigation

**Description**: Add badge showing unread count to tab bar or header.

**Implementation**:

**Mobile** (`mobile/app/(tabs)/_layout.js`):
- Create badge component:
  ```javascript
  import { View, Text, StyleSheet } from 'react-native';
  import { colors } from '../../src/theme/colors';
  
  export function NotificationBadge({ count }) {
    if (!count || count === 0) return null;
    
    return (
      <View style={styles.badge}>
        <Text style={styles.badgeText}>
          {count > 99 ? '99+' : count.toString()}
        </Text>
      </View>
    );
  }
  
  const styles = StyleSheet.create({
    badge: {
      position: 'absolute',
      top: -4,
      right: -4,
      backgroundColor: colors.error,
      borderRadius: 10,
      minWidth: 20,
      height: 20,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 6,
      borderWidth: 2,
      borderColor: colors.cardBackground,
    },
    badgeText: {
      color: colors.white,
      fontSize: 11,
      fontWeight: '700',
    },
  });
  ```

- Add notification icon to tab bar:
  ```javascript
  import { NotificationBadge } from '../../src/components/NotificationBadge';
  import { useAuth } from '../../src/navigation/AuthContext';
  import { useState, useEffect } from 'react';
  import { apiGet } from '../../src/api/client';
  
  // In TabsLayout component
  const [unreadCount, setUnreadCount] = useState(0);
  const { isAuthenticated } = useAuth();
  
  useEffect(() => {
    if (isAuthenticated) {
      loadUnreadCount();
      // Refresh every 30 seconds
      const interval = setInterval(loadUnreadCount, 30000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated]);
  
  const loadUnreadCount = async () => {
    try {
      const response = await apiGet('/notifications/unread-count');
      if (response.success) {
        setUnreadCount(response.data.unread_count || 0);
      }
    } catch (err) {
      console.error('[TabsLayout] Failed to load unread count:', err);
    }
  };
  
  // Add notification tab
  <Tabs.Screen
    name="notifications"
    options={{
      title: 'Notifications',
      tabBarIcon: ({ color, size }) => (
        <View>
          <Ionicons name="notifications" size={size} color={color} />
          <NotificationBadge count={unreadCount} />
        </View>
      ),
    }}
  />
  ```

**Files to Create**:
- `mobile/src/components/NotificationBadge.js` - Badge component

**Files to Modify**:
- `mobile/app/(tabs)/_layout.js` - Add badge to tab bar
- `mobile/app/notifications.js` - Update unread count when notifications change

#### 3.2 Quick Access Button

**Description**: Add floating action button or header button for quick access to notifications.

**Implementation**:

**Option A: Header Button** (Recommended)
- Add to main screens (COE list, profile):
  ```javascript
  import { useRouter } from 'expo-router';
  import { apiGet } from '../src/api/client';
  
  // In screen component
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  
  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => router.push('/notifications')}
          style={{ paddingRight: 16, position: 'relative' }}>
          <Ionicons name="notifications" size={24} color={colors.gold} />
          {unreadCount > 0 && <NotificationBadge count={unreadCount} />}
        </TouchableOpacity>
      ),
    });
  }, [navigation, unreadCount]);
  ```

**Option B: Floating Action Button**
- Create FAB component:
  ```javascript
  // mobile/src/components/FloatingActionButton.js
  import { TouchableOpacity, View, StyleSheet } from 'react-native';
  import { Ionicons } from '@expo/vector-icons';
  import { colors } from '../theme/colors';
  
  export function FloatingNotificationButton({ onPress, badgeCount }) {
    return (
      <TouchableOpacity
        style={styles.fab}
        onPress={onPress}
        activeOpacity={0.8}>
        <Ionicons name="notifications" size={24} color={colors.black} />
        {badgeCount > 0 && <NotificationBadge count={badgeCount} />}
      </TouchableOpacity>
    );
  }
  
  const styles = StyleSheet.create({
    fab: {
      position: 'absolute',
      bottom: 20,
      right: 20,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.gold,
      justifyContent: 'center',
      alignItems: 'center',
      elevation: 4,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 3.84,
    },
  });
  ```

**Files to Create**:
- `mobile/src/components/FloatingNotificationButton.js` (if using FAB)

**Files to Modify**:
- `mobile/app/(tabs)/index.js` - Add header button
- `mobile/app/(tabs)/profile.js` - Add header button

---

### Phase 4: Enhanced Actions (Priority: Medium)

**Estimated Time**: 8-10 hours  
**Goal**: Add swipe actions and batch operations

#### 4.1 Swipe Actions

**Description**: Allow users to swipe notifications to mark as read/unread or delete.

**Implementation**:

**Mobile** (`mobile/app/notifications.js`):
- Install swipe library (if not already):
  ```bash
  npm install react-native-gesture-handler
  ```

- Add swipe actions:
  ```javascript
  import { Swipeable } from 'react-native-gesture-handler';
  import { RectButton } from 'react-native-gesture-handler';
  
  const renderNotification = ({item}) => {
    const isUnread = !item.read;
    
    const renderRightActions = (progress, dragX) => {
      const scale = dragX.interpolate({
        inputRange: [-100, 0],
        outputRange: [1, 0],
        extrapolate: 'clamp',
      });
      
      return (
        <View style={styles.swipeActions}>
          {isUnread ? (
            <RectButton
              style={[styles.swipeAction, styles.markReadAction]}
              onPress={() => handleMarkAsRead(item)}>
              <Ionicons name="checkmark" size={24} color={colors.white} />
              <Text style={styles.swipeActionText}>Read</Text>
            </RectButton>
          ) : (
            <RectButton
              style={[styles.swipeAction, styles.markUnreadAction]}
              onPress={() => handleMarkAsUnread(item)}>
              <Ionicons name="mail-unread" size={24} color={colors.white} />
              <Text style={styles.swipeActionText}>Unread</Text>
            </RectButton>
          )}
          <RectButton
            style={[styles.swipeAction, styles.deleteAction]}
            onPress={() => handleDelete(item)}>
            <Ionicons name="trash" size={24} color={colors.white} />
            <Text style={styles.swipeActionText}>Delete</Text>
          </RectButton>
        </View>
      );
    };
    
    return (
      <Swipeable renderRightActions={renderRightActions}>
        <TouchableOpacity
          style={[styles.notificationItem, isUnread && styles.unreadItem]}
          onPress={() => handleNotificationPress(item)}>
          {/* ... existing notification content ... */}
        </TouchableOpacity>
      </Swipeable>
    );
  };
  ```

- Add action handlers:
  ```javascript
  const handleMarkAsUnread = async (notification) => {
    // Note: Backend may need endpoint for this
    // For now, we can use a workaround or implement backend endpoint
    try {
      // This would require a new endpoint: PUT /notifications/:id/unread
      await apiPut(`/notifications/${notification._id}/unread`, {});
      // Update local state
      setNotifications(prev =>
        prev.map(n =>
          n._id === notification._id
            ? {...n, read: false, read_at: null}
            : n
        )
      );
      setUnreadCount(prev => prev + 1);
    } catch (err) {
      console.error('[Notifications] Failed to mark as unread:', err);
    }
  };
  
  const handleDelete = async (notification) => {
    try {
      await apiDelete(`/notifications/${notification._id}`);
      setNotifications(prev => prev.filter(n => n._id !== notification._id));
      if (!notification.read) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (err) {
      console.error('[Notifications] Failed to delete:', err);
    }
  };
  ```

**Files to Modify**:
- `mobile/app/notifications.js` - Add swipe actions

**Backend** (New Endpoints Needed):
- `server/routes/notifications.js`:
  ```javascript
  /**
   * PUT /v1/notifications/:notificationId/unread
   * Mark notification as unread
   */
  router.put('/:notificationId/unread', authenticateToken, async (req, res) => {
    try {
      const notification = await notificationService.markAsUnread(
        req.params.notificationId,
        req.user._id
      );
      res.json({ success: true, data: { notification } });
    } catch (error) {
      res.status(500).json({ success: false, error: { message: error.message } });
    }
  });
  
  /**
   * DELETE /v1/notifications/:notificationId
   * Delete notification
   */
  router.delete('/:notificationId', authenticateToken, async (req, res) => {
    try {
      await notificationService.deleteNotification(
        req.params.notificationId,
        req.user._id
      );
      res.json({ success: true, message: 'Notification deleted' });
    } catch (error) {
      res.status(500).json({ success: false, error: { message: error.message } });
    }
  });
  ```

- `server/services/notificationService.js`:
  ```javascript
  /**
   * Mark notification as unread
   */
  async function markAsUnread(notificationId, userId) {
    const notification = await Notification.findOne({
      _id: notificationId,
      user_id: userId
    });
    
    if (!notification) {
      throw new Error('Notification not found');
    }
    
    notification.read = false;
    notification.read_at = null;
    await notification.save();
    
    return notification;
  }
  
  /**
   * Delete notification
   */
  async function deleteNotification(notificationId, userId) {
    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      user_id: userId
    });
    
    if (!notification) {
      throw new Error('Notification not found');
    }
    
    return notification;
  }
  ```

#### 4.2 Batch Operations

**Description**: Allow users to select multiple notifications and perform batch actions.

**Implementation**:

**Mobile** (`mobile/app/notifications.js`):
- Add selection mode:
  ```javascript
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedNotifications, setSelectedNotifications] = useState(new Set());
  
  const toggleSelection = (notificationId) => {
    const newSelection = new Set(selectedNotifications);
    if (newSelection.has(notificationId)) {
      newSelection.delete(notificationId);
    } else {
      newSelection.add(notificationId);
    }
    setSelectedNotifications(newSelection);
  };
  
  const selectAll = () => {
    const allIds = new Set(notifications.map(n => n._id.toString()));
    setSelectedNotifications(allIds);
  };
  
  const clearSelection = () => {
    setSelectedNotifications(new Set());
    setSelectionMode(false);
  };
  ```

- Add batch action bar:
  ```javascript
  const renderBatchActionBar = () => {
    if (!selectionMode) return null;
    
    const count = selectedNotifications.size;
    
    return (
      <View style={styles.batchActionBar}>
        <Text style={styles.batchActionText}>
          {count} selected
        </Text>
        <View style={styles.batchActions}>
          <TouchableOpacity
            style={styles.batchActionButton}
            onPress={handleBatchMarkAsRead}>
            <Ionicons name="checkmark" size={20} color={colors.gold} />
            <Text style={styles.batchActionButtonText}>Mark Read</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.batchActionButton}
            onPress={handleBatchDelete}>
            <Ionicons name="trash" size={20} color={colors.error} />
            <Text style={styles.batchActionButtonText}>Delete</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.batchActionButton}
            onPress={clearSelection}>
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };
  ```

- Add batch action handlers:
  ```javascript
  const handleBatchMarkAsRead = async () => {
    const ids = Array.from(selectedNotifications);
    try {
      await Promise.all(
        ids.map(id => apiPut(`/notifications/${id}/read`, {}))
      );
      setNotifications(prev =>
        prev.map(n =>
          selectedNotifications.has(n._id.toString())
            ? {...n, read: true, read_at: new Date()}
            : n
        )
      );
      setUnreadCount(prev => Math.max(0, prev - ids.length));
      clearSelection();
    } catch (err) {
      console.error('[Notifications] Batch mark as read failed:', err);
    }
  };
  
  const handleBatchDelete = async () => {
    const ids = Array.from(selectedNotifications);
    try {
      await Promise.all(
        ids.map(id => apiDelete(`/notifications/${id}`))
      );
      setNotifications(prev =>
        prev.filter(n => !selectedNotifications.has(n._id.toString()))
      );
      // Update unread count (count unread in deleted notifications)
      const deletedUnread = notifications.filter(
        n => selectedNotifications.has(n._id.toString()) && !n.read
      ).length;
      setUnreadCount(prev => Math.max(0, prev - deletedUnread));
      clearSelection();
    } catch (err) {
      console.error('[Notifications] Batch delete failed:', err);
    }
  };
  ```

**Files to Modify**:
- `mobile/app/notifications.js` - Add batch operations

#### 4.3 Delete All Read

**Description**: Add option to delete all read notifications at once.

**Implementation**:

**Mobile** (`mobile/app/notifications.js`):
- Add delete all read button:
  ```javascript
  const handleDeleteAllRead = async () => {
    Alert.alert(
      'Delete All Read',
      'Are you sure you want to delete all read notifications?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiDelete('/notifications/read-all');
              setNotifications(prev => prev.filter(n => !n.read));
            } catch (err) {
              console.error('[Notifications] Delete all read failed:', err);
            }
          },
        },
      ]
    );
  };
  ```

**Backend** (New Endpoint):
- `server/routes/notifications.js`:
  ```javascript
  /**
   * DELETE /v1/notifications/read-all
   * Delete all read notifications
   */
  router.delete('/read-all', authenticateToken, async (req, res) => {
    try {
      const result = await notificationService.deleteAllRead(req.user._id);
      res.json({
        success: true,
        message: 'All read notifications deleted',
        data: { deleted_count: result.deletedCount }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { message: error.message }
      });
    }
  });
  ```

- `server/services/notificationService.js`:
  ```javascript
  /**
   * Delete all read notifications for user
   */
  async function deleteAllRead(userId) {
    const result = await Notification.deleteMany({
      user_id: userId,
      read: true
    });
    return result;
  }
  ```

---

### Phase 5: Enhanced Object Access (Priority: High)

**Estimated Time**: 10-12 hours  
**Goal**: Show rich previews and quick actions for related objects

#### 5.1 Rich Preview Cards

**Description**: Show preview information for COEs, messages, and payments in notifications.

**Implementation**:

**Mobile** (`mobile/app/notifications.js`):
- Create preview components:
  ```javascript
  // COE Preview
  const renderCOEPreview = (notification) => {
    if (!notification.data?.coe_id) return null;
    
    // Fetch COE data (or pass from notification data if available)
    return (
      <View style={styles.previewCard}>
        <Text style={styles.previewTitle}>COE Preview</Text>
        {/* Show COE name, status, date if available */}
      </View>
    );
  };
  
  // Message Preview
  const renderMessagePreview = (notification) => {
    if (notification.type !== 'coe_message') return null;
    
    return (
      <View style={styles.previewCard}>
        <View style={styles.messagePreviewHeader}>
          <Text style={styles.messageSender}>
            {notification.body.split(':')[0]}
          </Text>
        </View>
        <Text style={styles.messagePreview} numberOfLines={2}>
          {notification.body.split(':').slice(1).join(':').trim()}
        </Text>
      </View>
    );
  };
  ```

- Update notification item to show preview:
  ```javascript
  const renderNotification = ({item}) => {
    // ... existing code ...
    
    return (
      <TouchableOpacity
        style={[styles.notificationItem, isUnread && styles.unreadItem]}
        onPress={() => handleNotificationPress(item)}>
        {/* ... existing icon and content ... */}
        
        {/* Add preview based on type */}
        {item.type === 'coe_message' && renderMessagePreview(item)}
        {item.type.startsWith('coe_') && renderCOEPreview(item)}
        {item.type.startsWith('payment_') && renderPaymentPreview(item)}
      </TouchableOpacity>
    );
  };
  ```

**Note**: For full COE/payment previews, may need to fetch additional data or include in notification response.

#### 5.2 Quick Actions

**Description**: Add quick action buttons directly on notification cards.

**Implementation**:

**Mobile** (`mobile/app/notifications.js`):
- Add quick actions:
  ```javascript
  const renderQuickActions = (notification) => {
    const actions = [];
    
    if (notification.data?.coe_id) {
      actions.push({
        label: 'View COE',
        icon: 'document-text',
        onPress: () => router.push({
          pathname: '/coe-detail',
          params: { coeId: notification.data.coe_id }
        })
      });
      
      if (notification.type === 'coe_message') {
        actions.push({
          label: 'Open Messages',
          icon: 'chatbubble',
          onPress: () => router.push({
            pathname: '/coe-messages',
            params: { coeId: notification.data.coe_id }
          })
        });
      }
      
      if (notification.type.startsWith('coe_') && 
          ['approved', 'pending_pay'].includes(/* COE status */)) {
        actions.push({
          label: 'Make Payment',
          icon: 'card',
          onPress: () => router.push({
            pathname: '/payment',
            params: { coeId: notification.data.coe_id }
          })
        });
      }
    }
    
    if (notification.data?.payment_id) {
      actions.push({
        label: 'View Payment',
        icon: 'receipt',
        onPress: () => router.push({
          pathname: '/payment-detail',
          params: { paymentId: notification.data.payment_id }
        })
      });
    }
    
    if (actions.length === 0) return null;
    
    return (
      <View style={styles.quickActions}>
        {actions.map((action, index) => (
          <TouchableOpacity
            key={index}
            style={styles.quickActionButton}
            onPress={action.onPress}>
            <Ionicons name={action.icon} size={18} color={colors.gold} />
            <Text style={styles.quickActionText}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };
  ```

**Files to Modify**:
- `mobile/app/notifications.js` - Add quick actions

---

### Phase 6: Real-time Updates (Priority: Medium)

**Estimated Time**: 4-6 hours  
**Goal**: Auto-refresh notifications and highlight new ones

#### 6.1 Live Updates

**Description**: Automatically refresh notifications when new ones arrive.

**Implementation**:

**Mobile** (`mobile/app/notifications.js`):
- Add notification listener:
  ```javascript
  import * as Notifications from 'expo-notifications';
  
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener(notification => {
      // Refresh notifications when new one arrives
      loadNotifications(1, false);
    });
    
    return () => subscription.remove();
  }, [loadNotifications]);
  ```

- Add new notification highlighting:
  ```javascript
  const [newNotificationIds, setNewNotificationIds] = useState(new Set());
  
  useEffect(() => {
    // Track new notifications
    const currentIds = new Set(notifications.map(n => n._id.toString()));
    const newIds = Array.from(currentIds).filter(id => 
      !previousNotificationIds.current.has(id)
    );
    
    if (newIds.length > 0) {
      setNewNotificationIds(new Set(newIds));
      // Clear highlight after 3 seconds
      setTimeout(() => {
        setNewNotificationIds(new Set());
      }, 3000);
    }
    
    previousNotificationIds.current = currentIds;
  }, [notifications]);
  
  // Add highlight style to new notifications
  const renderNotification = ({item}) => {
    const isNew = newNotificationIds.has(item._id.toString());
    // ... existing code ...
    return (
      <TouchableOpacity
        style={[
          styles.notificationItem,
          isUnread && styles.unreadItem,
          isNew && styles.newNotification
        ]}
        // ...
      >
        {/* ... */}
      </TouchableOpacity>
    );
  };
  ```

**Files to Modify**:
- `mobile/app/notifications.js` - Add real-time updates

---

## Implementation Priority

### Must Have (MVP Enhancement)
1. ✅ **Navigation Badge** - Quick win, high impact
2. ✅ **Date Grouping** - Better organization
3. ✅ **Notification Type Icons** - Better visual hierarchy
4. ✅ **Enhanced Read/Unread Design** - Better UX

### Should Have
5. **Filter Tabs** - Better navigation
6. **Swipe Actions** - Better interaction
7. **Rich Preview Cards** - Better context

### Nice to Have
8. **Search Functionality** - Advanced feature
9. **Batch Operations** - Power user feature
10. **Real-time Updates** - Polish feature

---

## Technical Requirements

### Backend Changes

**New Endpoints Needed**:
1. `PUT /v1/notifications/:notificationId/unread` - Mark as unread
2. `DELETE /v1/notifications/:notificationId` - Delete notification
3. `DELETE /v1/notifications/read-all` - Delete all read notifications

**Service Functions to Add**:
- `markAsUnread(notificationId, userId)`
- `deleteNotification(notificationId, userId)`
- `deleteAllRead(userId)`

**Files to Modify**:
- `server/routes/notifications.js` - Add new endpoints
- `server/services/notificationService.js` - Add service functions

### Mobile Changes

**New Components**:
- `mobile/src/components/NotificationBadge.js` - Badge component
- `mobile/src/components/FloatingNotificationButton.js` (optional) - FAB component

**Dependencies**:
- `react-native-gesture-handler` - For swipe actions (may already be installed)
- `@expo/vector-icons` - For icons (already installed)

**Files to Modify**:
- `mobile/app/notifications.js` - Main enhancements
- `mobile/app/(tabs)/_layout.js` - Add badge to tab bar
- `mobile/app/(tabs)/index.js` - Add header button
- `mobile/app/(tabs)/profile.js` - Add header button

---

## Testing Plan

### Backend Tests

1. **Delete Endpoint**
   - ✅ Delete notification successfully
   - ✅ Return 404 for non-existent notification
   - ✅ Return 403 for other user's notification
   - ✅ Update unread count correctly

2. **Mark as Unread Endpoint**
   - ✅ Mark notification as unread
   - ✅ Update read_at to null
   - ✅ Return 404 for non-existent notification

3. **Delete All Read Endpoint**
   - ✅ Delete all read notifications
   - ✅ Keep unread notifications
   - ✅ Return correct deleted count

### Mobile Tests

1. **Visual Enhancements**
   - ✅ Date grouping displays correctly
   - ✅ Icons show for each notification type
   - ✅ Read/unread visual distinction works

2. **Filtering**
   - ✅ Filter tabs work correctly
   - ✅ Search filters notifications
   - ✅ Filter state persists

3. **Navigation Badge**
   - ✅ Badge shows unread count
   - ✅ Badge updates in real-time
   - ✅ Badge hides when count is 0

4. **Swipe Actions**
   - ✅ Swipe to mark as read works
   - ✅ Swipe to delete works
   - ✅ Visual feedback during swipe

5. **Batch Operations**
   - ✅ Select multiple notifications
   - ✅ Batch mark as read works
   - ✅ Batch delete works

6. **Rich Previews**
   - ✅ COE previews show correctly
   - ✅ Message previews show correctly
   - ✅ Quick actions navigate correctly

---

## File Structure

### New Files

```
server/
├── services/
│   └── notificationService.js          # UPDATE - Add delete/mark unread functions

mobile/
├── src/
│   └── components/
│       ├── NotificationBadge.js        # NEW - Badge component
│       └── FloatingNotificationButton.js # NEW (optional) - FAB component
```

### Updated Files

```
server/
├── routes/
│   └── notifications.js                # UPDATE - Add delete/unread endpoints

mobile/
├── app/
│   ├── notifications.js                # UPDATE - All enhancements
│   └── (tabs)/
│       ├── _layout.js                   # UPDATE - Add badge to tab bar
│       ├── index.js                     # UPDATE - Add header button
│       └── profile.js                   # UPDATE - Add header button
```

---

## Estimated Timeline

- **Phase 1** (Visual Enhancements): 8-12 hours (1-2 days)
- **Phase 2** (Filtering): 6-8 hours (1 day)
- **Phase 3** (Navigation Integration): 4-6 hours (0.5-1 day)
- **Phase 4** (Enhanced Actions): 8-10 hours (1-2 days)
- **Phase 5** (Enhanced Object Access): 10-12 hours (1-2 days)
- **Phase 6** (Real-time Updates): 4-6 hours (0.5-1 day)

**Total**: ~40-54 hours (5-7 days)

**Recommended Approach**: Implement Phase 1 and Phase 3 first (MVP enhancements), then proceed with other phases based on priority.

---

## Related Documentation

- [Messaging Thread & Push Notifications](./MESSAGING-THREAD-AND-PUSH-NOTIFICATIONS.md) - Base notification system implementation
- [Mobile App Implementation Plan](./MOBILE-APP-IMPLEMENTATION-PLAN.md) - Overall mobile app structure
- [COE Status Flow](./COE-STATUS-FLOW.md) - COE status transitions and notifications

---

## Changelog

### Version 1.0 (January 2025)
- Initial enhancement plan
- Detailed implementation steps for all phases
- Backend and mobile implementation details
- Testing plan
- Timeline estimates

---

**Document Status**: Ready for Implementation  
**Next Steps**: Start with Phase 1 (Visual Enhancements) and Phase 3 (Navigation Integration) for quick wins

