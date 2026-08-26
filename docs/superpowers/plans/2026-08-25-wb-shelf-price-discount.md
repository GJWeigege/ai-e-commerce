# WB Shelf Price + Discount Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 上架时写入 WB `price`（原价）+ `discount`（%），单品三字段联动，批量策略扩展。

**Architecture:** `shelf-price.ts` 统一算出 `{ listPrice, salePrice, discount }`；队列/任务携带三者；`adapter.setPrice(nmId, listPrice, discount)`。

**Tech Stack:** NestJS、platform-core、Ant Design Pro

## Tasks

1. Rewrite `shelf-price.ts` + unit tests
2. Wire DTO / ProductService / WbListingJob / setPrice
3. Frontend services + catalog modal UI
4. Run tests / rebuild if needed
