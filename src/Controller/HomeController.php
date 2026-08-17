<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Annotation\Route;

class HomeController extends AbstractController
{
    public const ROLES = [
        'user'         => ['label' => 'Utilisateur',    'icon' => 'bi-person'],
        'role_recouv'  => ['label' => 'Recouvrement',   'icon' => 'bi-briefcase'],
        'role_notif'   => ['label' => 'Notification',   'icon' => 'bi-bell'],
        'role_mec'     => ['label' => 'MEC',             'icon' => 'bi-building'],
        'role_admin'   => ['label' => 'Administrateur', 'icon' => 'bi-shield-check'],
    ];

    #[Route('/switch-role/{role}', name: 'switch_role', methods: ['POST'])]
    public function switchRole(string $role, Request $request): Response
    {
        if (array_key_exists($role, self::ROLES)) { 
            $request->getSession()->set('stevia_role', $role);
        }
        return $this->redirect($request->headers->get('referer', '/'));
    }

    #[Route('/', name: 'home', methods: ['GET'])]
    public function index(): Response
    {
        $stats = [
            ['label' => 'Créances en cours', 'value' => 127, 'icon' => 'bi-file-earmark-text', 'color' => 'primary'],
            ['label' => 'Résolues ce mois', 'value' => 43,  'icon' => 'bi-check-circle',       'color' => 'success'],
            ['label' => 'En contentieux',    'value' => 18,  'icon' => 'bi-briefcase',           'color' => 'warning'],
            ['label' => 'Actions urgentes',  'value' => 15,  'icon' => 'bi-exclamation-triangle', 'color' => 'danger'],
        ];

        $recentDossiers = [
            ['ref' => 'REC-2024-0412', 'debiteur' => 'Entreprise Dupont SARL',   'montant' => '3 420,00 €', 'statut' => 'Amiable',     'date' => '02/04/2024'],
            ['ref' => 'REC-2024-0411', 'debiteur' => 'Martin Jean-Pierre',        'montant' => '890,50 €',   'statut' => 'Contentieux',  'date' => '01/04/2024'],
            ['ref' => 'REC-2024-0410', 'debiteur' => 'Cabinet Médical Dr. Roux',  'montant' => '12 750,00 €','statut' => 'Recouvré',     'date' => '31/03/2024'],
            ['ref' => 'REC-2024-0409', 'debiteur' => 'Transport Express 92',      'montant' => '5 100,00 €', 'statut' => 'Amiable',     'date' => '30/03/2024'],
            ['ref' => 'REC-2024-0408', 'debiteur' => 'Leroy Michel',              'montant' => '430,00 €',   'statut' => 'Clôturé',      'date' => '29/03/2024'],
        ];

        return $this->render('home/index.html.twig', [
            'stats' => $stats,
            'recentDossiers' => $recentDossiers,
        ]);
    }
}
