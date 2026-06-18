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

function makeEntity(table) {
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
      const { data, error } = await supabase
        .from(table)
        .insert(payload)
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
