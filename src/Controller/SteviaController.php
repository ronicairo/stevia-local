<?php

namespace App\Controller;

use Exception;
use Psr\Log\LoggerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Contracts\HttpClient\HttpClientInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Annotation\Route;
use Symfony\Contracts\Cache\CacheInterface;
use Symfony\Contracts\Cache\ItemInterface;

class SteviaController extends AbstractController
{
    private HttpClientInterface $client;
    private string $apiStevia;
    private LoggerInterface $logger;
    private LoggerInterface $trainingLogger;
    private CacheInterface $cache;

    public function __construct(
        HttpClientInterface $client,
        string $apiStevia,
        LoggerInterface $steviaLogger,
        LoggerInterface $steviaTrainingLogger,
        CacheInterface $cache
    ) {
        $this->client          = $client;
        $this->apiStevia       = $apiStevia;
        $this->logger          = $steviaLogger;
        $this->trainingLogger  = $steviaTrainingLogger;
        $this->cache           = $cache;
    }

    /**
     * ROUTE STREAMING PRINCIPALE
     */
    #[Route('/stevia/ask/stream', name: 'stevia_ask_stream', methods: ['POST'], options: ['expose' => true])]
    public function askSteviaStream(Request $request): StreamedResponse
    {
        $payload = json_decode($request->getContent(), true);
        $roles = $this->getSteviaRoles();

        if (!isset($payload['question'])) {
            return new StreamedResponse(
                function () {
                    echo json_encode(['content' => 'Aucune question reçue']) . "\n";
                },
                400,
                ['Content-Type' => 'text/event-stream']
            );
        }

        return new StreamedResponse(
            function () use ($payload, $roles) {
                try {
                    $response = $this->client->request(
                        'POST',
                        $this->apiStevia . '/ask/stream',
                        [
                            'json' => [
                                'question' => $payload['question'],
                                'roles'    => $roles,
                            ],
                            'timeout' => 100,
                            'buffer'  => false,
                        ]
                    );

                    foreach ($this->client->stream($response) as $chunk) {
                        if ($chunk->isLast()) {
                            break;
                        }

                        $content = $chunk->getContent();
                        if (!empty($content)) {
                            echo $content;
                            if (ob_get_level() > 0) ob_flush();
                            flush();
                        }
                    }

                } catch (Exception $e) {
                    $this->logger->error('Erreur streaming Stevia', ['message' => $e->getMessage()]);
                    echo json_encode(['content' => $this->formatErrorMessage($e)]) . "\n";
                    if (ob_get_level() > 0) ob_flush();
                    flush();
                }
            },
            200,
            [
                'Content-Type'    => 'text/event-stream',
                'Cache-Control'   => 'no-cache',
                'X-Accel-Buffering' => 'no',
                'Connection'      => 'keep-alive',
            ]
        );
    }

    /**
     * PAGE D'INDEXATION
     */
    #[Route('/stevia/indexation', name: 'stevia_indexation', methods: ['GET'], options: ['expose' => true])]
    public function indexationStevia(): Response
    {
        $offline = false;
        $books   = [];
        try {
            $books = $this->getBookstackBooks();
        } catch (Exception $e) {
            $offline = true;
        }
        if (!$offline && empty($books)) {
            try {
                $this->client->request('GET', $this->apiStevia . '/health', ['timeout' => 3]);
            } catch (Exception $e) {
                $offline = true;
            }
        }
        return $this->render('stevia/indexation.html.twig', ['books' => $books, 'offline' => $offline]);
    }

    #[Route('/stevia/index/book/{bookId}', name: 'stevia_index_book', methods: ['POST'], options: ['expose' => true])]
    public function indexBook(int $bookId): JsonResponse
    {
        try {
            $response = $this->client->request(
                'POST',
                sprintf('%s/index/bookstack/book/%d?force=true', $this->apiStevia, $bookId),
                ['timeout' => 180]
            );

            $data     = $response->toArray(false);
            $bookName = $data['book_name'] ?? 'Document';

            if (($data['status'] ?? '') === 'indexed') {
                $this->addFlash('success', sprintf('Le livre "%s" a été indexé avec succès.', $bookName));
                return new JsonResponse(['status' => 'success']);
            }

            if (($data['status'] ?? '') === 'skipped') {
                $this->addFlash('info', sprintf('Le livre "%s" est déjà à jour.', $bookName));
                return new JsonResponse(['status' => 'success']);
            }

            $this->addFlash('danger', sprintf('Erreur lors de l\'indexation du livre "%s".', $bookName));
            return new JsonResponse(['status' => 'error'], 400);

        } catch (Exception $e) {
            $this->logger->error('Erreur indexation livre', ['book_id' => $bookId, 'message' => $e->getMessage()]);
            $this->addFlash('danger', 'Erreur technique : ' . $e->getMessage());
            return new JsonResponse(['status' => 'error'], 500);
        }
    }

    #[Route('/stevia/delete/book/{bookId}', name: 'stevia_delete_book', methods: ['DELETE'], options: ['expose' => true])]
    public function deleteBookIndex(int $bookId): JsonResponse
    {
        try {
            $response = $this->client->request(
                'DELETE',
                sprintf('%s/index/bookstack/book/%d', $this->apiStevia, $bookId),
                ['timeout' => 30]
            );

            $data     = $response->toArray(false);
            $bookName = $data['book_name'] ?? 'Document';

            $this->addFlash('success', sprintf('Le livre "%s" a été supprimé.', $bookName));
            return new JsonResponse(['status' => 'success']);

        } catch (Exception $e) {
            $this->logger->error('Erreur suppression index livre', ['book_id' => $bookId, 'message' => $e->getMessage()]);
            $this->addFlash('danger', 'Erreur technique : ' . $e->getMessage());
            return new JsonResponse(['status' => 'error'], 500);
        }
    }

    #[Route('/stevia/index/all', name: 'stevia_index_all', methods: ['POST'], options: ['expose' => true])]
    public function indexAll(): JsonResponse
    {
        set_time_limit(0);
        try {
            $response = $this->client->request('GET', $this->apiStevia . '/bookstack/books', ['timeout' => 30]);
            $books    = $response->toArray(false)['data'] ?? [];

            $nbIndexed = 0;
            $nbErrors  = 0;

            foreach ($books as $book) {
                $bookId = $book['id'] ?? null;
                if (!$bookId) continue;

                try {
                    $resp = $this->client->request(
                        'POST',
                        sprintf('%s/index/bookstack/book/%d?force=true', $this->apiStevia, $bookId),
                        ['timeout' => 600]
                    );
                    if (($resp->toArray(false)['status'] ?? '') === 'indexed') $nbIndexed++;
                } catch (\Exception $e) {
                    $nbErrors++;
                }
            }

            $this->addFlash('success', "Indexation terminée : $nbIndexed livre(s) indexé(s).");
            return $this->json(['status' => 'success', 'indexed' => $nbIndexed, 'errors' => $nbErrors]);

        } catch (\Exception $e) {
            $this->logger->error('Erreur indexation complète', ['message' => $e->getMessage()]);
            $this->addFlash('danger', 'Erreur technique : ' . $e->getMessage());
            return $this->json(['status' => 'error', 'message' => $e->getMessage()], 500);
        }
    }

    #[Route('/stevia/delete/all', name: 'stevia_delete_all', methods: ['DELETE'], options: ['expose' => true])]
    public function deleteAll(): JsonResponse
    {
        try {
            $response = $this->client->request('GET', $this->apiStevia . '/indexed/bookstack/books', ['timeout' => 30]);
            $books    = $response->toArray(false)['data'] ?? [];

            $nbDeleted = 0;
            $nbErrors  = 0;

            foreach ($books as $book) {
                $bookId = $book['book_id'] ?? null;
                if (!$bookId) continue;

                try {
                    $resp = $this->client->request(
                        'DELETE',
                        sprintf('%s/index/bookstack/book/%d', $this->apiStevia, $bookId),
                        ['timeout' => 30]
                    );
                    if (($resp->toArray(false)['status'] ?? '') === 'deleted') $nbDeleted++;
                } catch (\Exception $e) {
                    $nbErrors++;
                }
            }

            $this->addFlash('success', "Suppression terminée : $nbDeleted livre(s) supprimé(s).");
            return $this->json(['status' => 'success', 'deleted' => $nbDeleted, 'errors' => $nbErrors]);

        } catch (\Exception $e) {
            $this->logger->error('Erreur suppression complète', ['message' => $e->getMessage()]);
            $this->addFlash('danger', 'Erreur technique : ' . $e->getMessage());
            return $this->json(['status' => 'error', 'message' => $e->getMessage()], 500);
        }
    }

    #[Route('/stevia/health', name: 'stevia_health', methods: ['GET'], options: ['expose' => true])]
    public function healthCheckStevia(): JsonResponse
    {
        $now  = new \DateTime('now', new \DateTimeZone('Europe/Paris'));
        $time = (int)$now->format('G') * 60 + (int)$now->format('i');
        $dow  = (int)$now->format('N');

        if (!($dow <= 5 && $time >= 450 && $time < 1110)) {
            return new JsonResponse(['status' => 'offline']);
        }

        try {
            $response = $this->client->request('GET', $this->apiStevia . '/health', ['timeout' => 5]);

            if ($response->getStatusCode() === 200) {
                $data = $response->toArray(false);
                if (isset($data['status']) && $data['status'] === 'online') {
                    return new JsonResponse(['status' => 'online']);
                }
            }
        } catch (Exception $e) {
            $alreadyLogged = true;
            $this->cache->get('stevia_offline_logged', function (ItemInterface $item) use (&$alreadyLogged) {
                $item->expiresAfter(3600);
                $alreadyLogged = false;
                return true;
            });
            if (!$alreadyLogged) {
                $this->logger->error('Stevia API hors ligne', ['message' => $e->getMessage()]);
            }
            return new JsonResponse(['status' => 'offline', 'error' => $e->getMessage()], 503);
        }

        return new JsonResponse(['status' => 'offline'], 503);
    }

    /**
     * FEEDBACK UTILISATEUR — loggé dans stevia_training.log
     */
    #[Route('/stevia/feedback', name: 'stevia_feedback', methods: ['POST'], options: ['expose' => true])]
    public function feedback(Request $request): JsonResponse
    {
        $data = json_decode($request->getContent(), true);

        $question = $data['question'] ?? '';
        $answer   = $data['answer']   ?? '';
        $feedback = $data['feedback'] ?? '';

        $username = 'local';

        $cleanAnswer = preg_replace(
            '/<a href="([^"]+)"[^>]*>[^<]*<\/a>/',
            'Source: $1',
            strip_tags($answer, '<a>')
        );
        $cleanAnswer = strip_tags($cleanAnswer);

        $logData = [
            'user'     => $username,
            'question' => $question,
            'answer'   => trim($cleanAnswer),
        ];

        if ($feedback === 'negative') {
            $this->trainingLogger->warning('Feedback négatif', $logData);
        } else {
            $this->trainingLogger->info('Feedback positif', $logData);
        }

        // Transmettre aussi à l'API Python pour stocker en BDD (dataset ML)
        try {
            $this->client->request('POST', $this->apiStevia . '/feedback', [
                'json'    => $data,
                'timeout' => 5,
            ]);
        } catch (Exception $e) {
            $this->logger->warning('Feedback non transmis à l\'API Python', ['message' => $e->getMessage()]);
        }

        return $this->json(['status' => 'ok']);
    }

    /**
     * PAGE ML
     */
    #[Route('/stevia/ml', name: 'stevia_ml', methods: ['GET'], options: ['expose' => true])]
    public function mlIndex(): Response
    {
        try {
            $response = $this->client->request('GET', $this->apiStevia . '/ml/status', ['timeout' => 5]);
            $status   = $response->toArray(false);
        } catch (Exception $e) {
            $status = ['model_trained' => false, 'error' => $e->getMessage()];
        }

        return $this->render('ml/index.html.twig', ['status' => $status]);
    }

    /**
     * STATUT ML — loggé dans stevia_training.log
     */
    #[Route('/stevia/ml/status', name: 'stevia_ml_status', methods: ['GET'], options: ['expose' => true])]
    public function mlStatus(): JsonResponse
    {
        try {
            $response = $this->client->request('GET', $this->apiStevia . '/ml/status', ['timeout' => 10]);
            $data = $response->toArray(false);
            $this->trainingLogger->info('Statut ML consulté', $data);
            return $this->json($data);
        } catch (Exception $e) {
            $this->logger->error('Erreur statut ML', ['message' => $e->getMessage()]);
            return $this->json(['status' => 'error'], 500);
        }
    }

    /**
     * RESET MODÈLE ML
     */
    #[Route('/stevia/ml/reset', name: 'stevia_ml_reset', methods: ['DELETE'], options: ['expose' => true])]
    public function mlReset(): JsonResponse
    {
        try {
            $this->trainingLogger->warning('Reset modèle ML demandé');
            $response = $this->client->request('DELETE', $this->apiStevia . '/ml/reset', ['timeout' => 10]);
            $data = $response->toArray(false);
            $this->trainingLogger->info('Reset modèle ML effectué', $data);
            return $this->json($data);
        } catch (Exception $e) {
            $this->logger->error('Erreur reset ML', ['message' => $e->getMessage()]);
            return $this->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * LANCEMENT ENTRAÎNEMENT ML — loggé dans stevia_training.log
     */
    #[Route('/stevia/ml/run/{step}', name: 'stevia_ml_run', methods: ['POST'], options: ['expose' => true])]
    public function mlRun(string $step): StreamedResponse
    {
        $this->trainingLogger->info('Lancement entraînement ML', ['step' => $step]);
        $apiUrl = $this->apiStevia . '/ml/run/' . $step;

        return new StreamedResponse(function () use ($apiUrl, $step) {
            set_time_limit(0);
            try {
                $response = $this->client->request('POST', $apiUrl, ['timeout' => 600]);
                foreach ($this->client->stream($response) as $chunk) {
                    echo $chunk->getContent();
                    if (ob_get_level() > 0) ob_flush();
                    flush();
                }
                $this->trainingLogger->info('Entraînement ML terminé', ['step' => $step]);
            } catch (Exception $e) {
                $this->trainingLogger->error('Erreur entraînement ML', ['step' => $step, 'message' => $e->getMessage()]);
                echo json_encode(['error' => $e->getMessage()]);
            }
        }, 200, [
            'Content-Type'      => 'text/event-stream',
            'Cache-Control'     => 'no-cache',
            'X-Accel-Buffering' => 'no',
        ]);
    }

    /**
     * LOG ERREUR CLIENT (JS → Monolog stevia)
     */
    #[Route('/stevia/log/error', name: 'stevia_log_error', methods: ['POST'], options: ['expose' => true])]
    public function logClientError(Request $request): JsonResponse
    {
        $data   = json_decode($request->getContent(), true);
        $status = $data['status'] ?? 'inconnu';
        $msg    = $data['message'] ?? '';

        $this->logger->error('Erreur client JS', ['http_status' => $status, 'message' => $msg]);

        return $this->json(['status' => 'logged']);
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────

    private function getBookstackBooks(): array
    {
        try {
            $response = $this->client->request('GET', $this->apiStevia . '/bookstack/books', ['timeout' => 10]);
            if ($response->getStatusCode() === 200) {
                $payload = $response->toArray(false);
                if (($payload['status'] ?? '') === 'ok') return $payload['data'] ?? [];
                $this->addFlash('warning', 'BookStack : ' . ($payload['message'] ?? 'Erreur inconnue'));
            }
        } catch (Exception $e) {
            $this->addFlash('warning', 'Stevia API inaccessible : ' . $e->getMessage());
        }
        return [];
    }

    private function formatErrorMessage(Exception $e): string
    {
        if (str_contains($e->getMessage(), 'timeout')) return 'Timeout atteint.';
        if (str_contains($e->getMessage(), 'Could not resolve host')) return 'Serveur Python inaccessible.';
        return 'Erreur : ' . $e->getMessage();
    }

    private function getSteviaRoles(): array
    {
        // En local sans SecurityBundle : rôle simulé via session
        $role = $this->container->has('request_stack')
            ? ($this->container->get('request_stack')->getSession()->get('stevia_role', 'user'))
            : 'user';
        return [$role];
    }
}
