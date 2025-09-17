import express from 'express';
import { pool } from '../database/init.js';

/**
 * ROUTES MÉTRIQUES QUALITÉ PSA
 * 
 * Fournit des statistiques détaillées sur la qualité du workflow PSA
 * et l'efficacité du système de vérifications vidéo.
 */

export function createMetricsRoutes() {
  const router = express.Router();

  // Métriques globales de qualité vidéo
  router.get('/video-quality', async (req, res) => {
    try {
      const { period = '30' } = req.query; // Période en jours

      console.log(`📊 Calcul métriques qualité vidéo (${period} jours)`);

      const periodCondition = `created_at >= CURRENT_DATE - INTERVAL '${parseInt(period)} days'`;

      // Statistiques globales vidéo
      const videoStats = await pool.query(`
        SELECT 
          COUNT(*) as total_commands,
          COUNT(*) FILTER (WHERE video_status = 'uploaded') as videos_uploaded,
          COUNT(*) FILTER (WHERE video_status = 'pending') as videos_pending,
          COUNT(*) FILTER (WHERE video_status = 'error') as videos_error,
          COUNT(*) FILTER (WHERE video_override_admin IS NOT NULL) as admin_overrides,
          ROUND(
            (COUNT(*) FILTER (WHERE video_status = 'uploaded')::FLOAT / 
             NULLIF(COUNT(*), 0) * 100), 2
          ) as video_completion_rate,
          AVG(
            EXTRACT(HOURS FROM recording_timestamp - created_at)
          ) FILTER (WHERE recording_timestamp IS NOT NULL) as avg_hours_to_video
        FROM grading_requests 
        WHERE ${periodCondition}
      `);

      // Métriques par type de gradation
      const gradingTypeStats = await pool.query(`
        SELECT 
          grading_type,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE video_status = 'uploaded') as with_video,
          ROUND(
            (COUNT(*) FILTER (WHERE video_status = 'uploaded')::FLOAT / 
             NULLIF(COUNT(*), 0) * 100), 2
          ) as completion_rate
        FROM grading_requests 
        WHERE ${periodCondition}
        GROUP BY grading_type
        ORDER BY total DESC
      `);

      // Évolution quotidienne
      const dailyEvolution = await pool.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as commands_created,
          COUNT(*) FILTER (WHERE video_status = 'uploaded') as videos_completed,
          COUNT(*) FILTER (WHERE video_override_admin IS NOT NULL) as overrides_used
        FROM grading_requests 
        WHERE ${periodCondition}
        GROUP BY DATE(created_at)
        ORDER BY date DESC
        LIMIT 30
      `);

      // Statistiques de rappels automatiques
      const reminderStats = await pool.query(`
        SELECT 
          COUNT(DISTINCT ar.submission_id) as total_reminders_sent,
          SUM(ar.reminder_count) as total_reminder_emails,
          AVG(ar.reminder_count) as avg_reminders_per_command,
          COUNT(DISTINCT gr.submission_id) FILTER (
            WHERE gr.video_status = 'uploaded' 
            AND gr.recording_timestamp > ar.first_reminder_sent
          ) as successful_reminder_conversions
        FROM automated_reminders ar
        LEFT JOIN grading_requests gr ON ar.submission_id = gr.submission_id
        WHERE ar.first_reminder_sent >= CURRENT_DATE - INTERVAL '${parseInt(period)} days'
      `);

      const metrics = {
        global_stats: videoStats.rows[0],
        by_grading_type: gradingTypeStats.rows,
        daily_evolution: dailyEvolution.rows,
        reminder_effectiveness: reminderStats.rows[0],
        period_days: parseInt(period),
        calculated_at: new Date().toISOString()
      };

      res.json({
        success: true,
        metrics: metrics,
        summary: {
          total_commands: metrics.global_stats.total_commands,
          video_rate: metrics.global_stats.video_completion_rate,
          avg_time_to_video: Math.round(metrics.global_stats.avg_hours_to_video || 0),
          override_rate: Math.round((metrics.global_stats.admin_overrides / metrics.global_stats.total_commands) * 100 || 0)
        }
      });

    } catch (error) {
      console.error('❌ Erreur calcul métriques qualité vidéo:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors du calcul des métriques'
      });
    }
  });

  // Métriques d'efficacité des alertes
  router.get('/alert-effectiveness', async (req, res) => {
    try {
      const { period = '30' } = req.query;

      console.log(`📊 Calcul efficacité alertes (${period} jours)`);

      // Statistiques des alertes générées
      const alertStats = await pool.query(`
        SELECT 
          alert_type,
          alert_level,
          COUNT(*) as total_alerts,
          COUNT(*) FILTER (WHERE resolved = true) as resolved_alerts,
          AVG(
            EXTRACT(HOURS FROM resolved_at - created_at)
          ) FILTER (WHERE resolved_at IS NOT NULL) as avg_resolution_hours
        FROM admin_alerts 
        WHERE created_at >= CURRENT_DATE - INTERVAL '${parseInt(period)} days'
        GROUP BY alert_type, alert_level
        ORDER BY total_alerts DESC
      `);

      // Efficacité des rappels clients
      const reminderEffectiveness = await pool.query(`
        SELECT 
          COUNT(*) as total_reminders,
          COUNT(DISTINCT ar.submission_id) as unique_commands_reminded,
          COUNT(*) FILTER (
            WHERE EXISTS (
              SELECT 1 FROM grading_requests gr 
              WHERE gr.submission_id = ar.submission_id 
              AND gr.video_status = 'uploaded'
              AND gr.recording_timestamp > ar.first_reminder_sent
            )
          ) as successful_conversions,
          AVG(
            EXTRACT(HOURS FROM gr.recording_timestamp - ar.first_reminder_sent)
          ) FILTER (
            WHERE gr.recording_timestamp > ar.first_reminder_sent
            AND gr.video_status = 'uploaded'
          ) as avg_conversion_hours
        FROM automated_reminders ar
        LEFT JOIN grading_requests gr ON ar.submission_id = gr.submission_id
        WHERE ar.first_reminder_sent >= CURRENT_DATE - INTERVAL '${parseInt(period)} days'
      `);

      // Tendances des commandes à risque
      const riskTrends = await pool.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) FILTER (
            WHERE video_status IS NULL OR video_status = 'pending'
            AND EXTRACT(HOURS FROM NOW() - created_at) > 48
          ) as commands_at_risk_48h,
          COUNT(*) FILTER (
            WHERE video_status IS NULL OR video_status = 'pending'
            AND EXTRACT(HOURS FROM NOW() - created_at) > (7*24)
          ) as commands_at_risk_7d
        FROM grading_requests 
        WHERE created_at >= CURRENT_DATE - INTERVAL '${parseInt(period)} days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
        LIMIT 30
      `);

      const effectiveness = {
        alert_breakdown: alertStats.rows,
        reminder_performance: reminderEffectiveness.rows[0],
        daily_risk_trends: riskTrends.rows,
        period_days: parseInt(period)
      };

      // Calcul du taux de conversion global
      const conversionRate = effectiveness.reminder_performance.successful_conversions / 
                           Math.max(effectiveness.reminder_performance.total_reminders, 1) * 100;

      res.json({
        success: true,
        effectiveness: effectiveness,
        summary: {
          conversion_rate: Math.round(conversionRate),
          avg_conversion_time: Math.round(effectiveness.reminder_performance.avg_conversion_hours || 0),
          total_alerts: alertStats.rows.reduce((sum, row) => sum + parseInt(row.total_alerts), 0),
          resolution_rate: Math.round(
            alertStats.rows.reduce((sum, row) => sum + parseInt(row.resolved_alerts), 0) /
            Math.max(alertStats.rows.reduce((sum, row) => sum + parseInt(row.total_alerts), 0), 1) * 100
          )
        }
      });

    } catch (error) {
      console.error('❌ Erreur calcul efficacité alertes:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors du calcul de l\'efficacité'
      });
    }
  });

  // Rapport détaillé de performance
  router.get('/performance-report', async (req, res) => {
    try {
      const { period = '30', format = 'json' } = req.query;

      console.log(`📊 Génération rapport performance (${period} jours)`);

      // Métriques de performance globales
      const performanceMetrics = await pool.query(`
        WITH command_stats AS (
          SELECT 
            submission_id,
            created_at,
            video_status,
            recording_timestamp,
            video_override_admin,
            EXTRACT(HOURS FROM COALESCE(recording_timestamp, NOW()) - created_at) as hours_to_video
          FROM grading_requests 
          WHERE created_at >= CURRENT_DATE - INTERVAL '${parseInt(period)} days'
        ),
        reminder_stats AS (
          SELECT 
            ar.submission_id,
            ar.reminder_count,
            ar.first_reminder_sent,
            CASE 
              WHEN gr.video_status = 'uploaded' 
              AND gr.recording_timestamp > ar.first_reminder_sent 
              THEN true 
              ELSE false 
            END as reminder_successful
          FROM automated_reminders ar
          LEFT JOIN grading_requests gr ON ar.submission_id = gr.submission_id
          WHERE ar.first_reminder_sent >= CURRENT_DATE - INTERVAL '${parseInt(period)} days'
        )
        SELECT 
          -- Métriques principales
          COUNT(*) as total_commands,
          COUNT(*) FILTER (WHERE video_status = 'uploaded') as completed_videos,
          COUNT(*) FILTER (WHERE video_override_admin IS NOT NULL) as admin_overrides,
          
          -- Taux et moyennes
          ROUND(AVG(hours_to_video) FILTER (WHERE video_status = 'uploaded'), 2) as avg_completion_time,
          ROUND(STDDEV(hours_to_video) FILTER (WHERE video_status = 'uploaded'), 2) as completion_time_variance,
          
          -- Performance par tranche de temps
          COUNT(*) FILTER (WHERE video_status = 'uploaded' AND hours_to_video <= 24) as completed_within_24h,
          COUNT(*) FILTER (WHERE video_status = 'uploaded' AND hours_to_video <= 48) as completed_within_48h,
          COUNT(*) FILTER (WHERE video_status = 'uploaded' AND hours_to_video <= 168) as completed_within_7d,
          
          -- Efficacité des rappels
          (SELECT COUNT(*) FROM reminder_stats) as total_reminders,
          (SELECT COUNT(*) FILTER (WHERE reminder_successful) FROM reminder_stats) as successful_reminders
          
        FROM command_stats
      `);

      // Top problèmes identifiés
      const topIssues = await pool.query(`
        SELECT 
          'Commandes anciennes sans vidéo' as issue_type,
          COUNT(*) as count,
          'critical' as severity
        FROM grading_requests 
        WHERE video_status != 'uploaded' 
        AND EXTRACT(HOURS FROM NOW() - created_at) > (7*24)
        AND created_at >= CURRENT_DATE - INTERVAL '${parseInt(period)} days'
        
        UNION ALL
        
        SELECT 
          'Erreurs vidéo récurrentes' as issue_type,
          COUNT(*) as count,
          'warning' as severity
        FROM grading_requests 
        WHERE video_status = 'error'
        AND created_at >= CURRENT_DATE - INTERVAL '${parseInt(period)} days'
        
        UNION ALL
        
        SELECT 
          'Overrides admin fréquents' as issue_type,
          COUNT(*) as count,
          'info' as severity
        FROM grading_requests 
        WHERE video_override_admin IS NOT NULL
        AND created_at >= CURRENT_DATE - INTERVAL '${parseInt(period)} days'
        
        ORDER BY count DESC
      `);

      const report = {
        period: {
          days: parseInt(period),
          start_date: new Date(Date.now() - (parseInt(period) * 24 * 60 * 60 * 1000)).toISOString(),
          end_date: new Date().toISOString()
        },
        performance: performanceMetrics.rows[0],
        top_issues: topIssues.rows,
        recommendations: generateRecommendations(performanceMetrics.rows[0], topIssues.rows),
        generated_at: new Date().toISOString()
      };

      // Calculs supplémentaires
      const perf = report.performance;
      perf.completion_rate = Math.round((perf.completed_videos / perf.total_commands) * 100);
      perf.override_rate = Math.round((perf.admin_overrides / perf.total_commands) * 100);
      perf.within_24h_rate = Math.round((perf.completed_within_24h / perf.completed_videos) * 100);
      perf.within_48h_rate = Math.round((perf.completed_within_48h / perf.completed_videos) * 100);
      perf.reminder_success_rate = Math.round((perf.successful_reminders / Math.max(perf.total_reminders, 1)) * 100);

      res.json({
        success: true,
        report: report,
        summary: {
          overall_score: calculateOverallScore(report.performance),
          key_metrics: {
            completion_rate: perf.completion_rate,
            avg_time: perf.avg_completion_time,
            reminder_effectiveness: perf.reminder_success_rate
          },
          action_items: report.recommendations.filter(r => r.priority === 'high').length
        }
      });

    } catch (error) {
      console.error('❌ Erreur génération rapport performance:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la génération du rapport'
      });
    }
  });

  return router;
}

/**
 * Génère des recommandations basées sur les métriques
 * @param {Object} performance - Métriques de performance
 * @param {Array} issues - Liste des problèmes identifiés
 * @returns {Array} Liste de recommandations
 */
function generateRecommendations(performance, issues) {
  const recommendations = [];

  // Analyse du taux de complétion
  const completionRate = (performance.completed_videos / performance.total_commands) * 100;
  
  if (completionRate < 80) {
    recommendations.push({
      type: 'completion_rate',
      priority: 'high',
      message: `Taux de complétion vidéo faible (${Math.round(completionRate)}%)`,
      actions: [
        'Augmenter la fréquence des rappels automatiques',
        'Améliorer les instructions pour les clients',
        'Analyser les causes d\'abandon'
      ]
    });
  }

  // Analyse du temps de complétion
  if (performance.avg_completion_time > 72) {
    recommendations.push({
      type: 'completion_time',
      priority: 'medium',
      message: `Temps moyen de complétion élevé (${performance.avg_completion_time}h)`,
      actions: [
        'Envoyer des rappels plus précoces',
        'Simplifier le processus d\'enregistrement',
        'Offrir un support technique proactif'
      ]
    });
  }

  // Analyse des overrides
  const overrideRate = (performance.admin_overrides / performance.total_commands) * 100;
  
  if (overrideRate > 15) {
    recommendations.push({
      type: 'override_rate',
      priority: 'medium',
      message: `Taux d'overrides admin élevé (${Math.round(overrideRate)}%)`,
      actions: [
        'Analyser les raisons des overrides récurrents',
        'Améliorer le processus de validation automatique',
        'Former les clients sur l\'importance des vidéos'
      ]
    });
  }

  // Analyse des problèmes critiques
  const criticalIssues = issues.filter(i => i.severity === 'critical' && i.count > 0);
  
  if (criticalIssues.length > 0) {
    recommendations.push({
      type: 'critical_issues',
      priority: 'high',
      message: `${criticalIssues.length} problèmes critiques détectés`,
      actions: [
        'Traiter immédiatement les commandes anciennes',
        'Contacter personnellement les clients concernés',
        'Réviser les seuils d\'alerte automatiques'
      ]
    });
  }

  return recommendations;
}

/**
 * Calcule un score global de performance (0-100)
 * @param {Object} performance - Métriques de performance
 * @returns {number} Score de performance
 */
function calculateOverallScore(performance) {
  const completionRate = (performance.completed_videos / performance.total_commands) * 100;
  const overrideRate = (performance.admin_overrides / performance.total_commands) * 100;
  const reminderSuccessRate = (performance.successful_reminders / Math.max(performance.total_reminders, 1)) * 100;
  
  // Pondération: 50% complétion, 25% overrides (inversé), 25% efficacité rappels
  const score = (
    (completionRate * 0.5) +
    ((100 - overrideRate) * 0.25) +
    (reminderSuccessRate * 0.25)
  );
  
  return Math.round(Math.min(100, Math.max(0, score)));
}