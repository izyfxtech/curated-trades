/**
 * Supabase entity helpers — drop-in replacement for base44.entities.*
 *
 * All methods are bound to the authenticated user via Supabase RLS.
 * The API surface mirrors the original Base44 SDK:
 *   Entity.list(orderBy?, limit?)
 *   Entity.filter(match)
 *   Entity.create(data)
 *   Entity.update(id, data)
 *   Entity.delete(id)
 *
 * Base44 used snake_case "-field" prefix for descending order.
 * We preserve that convention here.
 */

import { supabase } from './supabaseClient';

function parseOrder(orderStr) {
  if (!orderStr) return { column: 'created_at', ascending: false };
  const ascending = !orderStr.startsWith('-');
  const column = ascending ? orderStr : orderStr.slice(1);
  return { column, ascending };
}

// Tables that have a user_id column (for auto-inject on create)
const USER_OWNED_TABLES = new Set(['trades', 'accounts', 'strategies', 'journal_templates', 'shared_views']);

async function getCurrentUserId() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

function makeEntity(table) {
  const isUserOwned = USER_OWNED_TABLES.has(table);

  return {
    async list(orderBy = '-created_at', limit = 1000) {
      const { column, ascending } = parseOrder(orderBy);
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .order(column, { ascending })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },

    async filter(match) {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .match(match);
      if (error) throw error;
      return data ?? [];
    },

    async create(payload) {
      // Auto-inject user_id so RLS insert check passes
      let enriched = { ...payload };
      if (isUserOwned && !enriched.user_id) {
        const uid = await getCurrentUserId();
        if (uid) enriched.user_id = uid;
      }
      const { data, error } = await supabase
        .from(table)
        .insert(enriched)
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    async update(id, payload) {
      const { data, error } = await supabase
        .from(table)
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    async delete(id) {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('id', id);
      if (error) throw error;
      return { id };
    },
  };
}

export const entities = {
  Trade:           makeEntity('trades'),
  Account:         makeEntity('accounts'),
  Strategy:        makeEntity('strategies'),
  JournalTemplate: makeEntity('journal_templates'),
  SharedView:      makeEntity('shared_views'),
};
